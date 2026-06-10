const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { active, dbConfig } = require('./db.config');
const { s3Config } = require('./s3.config');
const { marked } = require('marked');


require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Multer：内存存储
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('仅支持 JPG/PNG/GIF/WebP/BMP 图片格式'));
        }
    },
});

// Multer：附件上传（文件类型不限，20MB限制）
const uploadAttachment = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// S3 客户端
const s3 = new S3Client({
    endpoint: s3Config.endpoint,
    region: s3Config.region,
    credentials: {
        accessKeyId: s3Config.accessKey,
        secretAccessKey: s3Config.secretKey,
    },
    forcePathStyle: true,
    requestHandler: new NodeHttpHandler({
        connectionTimeout: 10_000,  // 连接超时 10 秒
        requestTimeout: 15_000,     // 请求超时 15 秒
    }),
});

// MySQL 连接配置
const pool = mysql.createPool({
    ...dbConfig,
    connectionLimit: 10,
    connectTimeout: 10000,     // TCP 连接超时 10秒
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,     // TCP keep-alive，防止防火墙断开
    keepAliveInitialDelay: 0,
});

// 测试连接
pool.getConnection((err, connection) => {
    if (err) {
        console.error(`MySQL [${active}] 连接失败:`, err.message);
        console.error('连接配置:', {
            host: dbConfig.host,
            port: dbConfig.port,
            user: dbConfig.user,
            database: dbConfig.database
        });
    } else {
        console.log(`✅ MySQL [${active}] 连接成功`);
        console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
        connection.release();
    }
});

app.use(cors());
app.use(bodyParser.json());

// 封装查询函数（带超时保护）
const query = (sql, values = []) => {
    return new Promise((resolve, reject) => {
        pool.query({ sql, values, timeout: 30_000 }, (err, results) => {
            if (err) {
                if (err.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
                    reject(new Error(`查询超时（30秒）：${sql.substring(0, 80)}...`));
                } else {
                    reject(err);
                }
            } else {
                resolve(results);
            }
        });
    });
};

// ============ 仓库 API ============

// 获取所有仓库
app.get('/api/warehouses', async (req, res) => {
    try {
        const warehouses = await query('SELECT * FROM warehouses ORDER BY id');
        res.json(warehouses);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 添加仓库
app.post('/api/warehouses', async (req, res) => {
    try {
        const { name, description } = req.body;
        const result = await query(
            'INSERT INTO warehouses (name, description) VALUES (?, ?)',
            [name, description || '']
        );
        res.json({ id: result.insertId, name, description });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 更新仓库
app.put('/api/warehouses/:id', async (req, res) => {
    try {
        const { name, description } = req.body;
        await query(
            'UPDATE warehouses SET name=?, description=? WHERE id=?',
            [name, description, req.params.id]
        );
        res.json({ id: req.params.id, name, description });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 删除仓库（同时删除该仓库下的设备）
app.delete('/api/warehouses/:id', async (req, res) => {
    try {
        // 先获取仓库名称
        const warehouses = await query('SELECT name FROM warehouses WHERE id=?', [req.params.id]);
        if (warehouses.length > 0) {
            const warehouseName = warehouses[0].name;
            // 删除该仓库下的所有设备
            await query('DELETE FROM devices WHERE warehouse_name=?', [warehouseName]);
        }
        // 删除仓库
        await query('DELETE FROM warehouses WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ 设备 API ============

// 生成下一个可用的6位设备ID码
app.get('/api/devices/next-code', async (req, res) => {
    try {
        // 查找当前最大的纯数字设备ID
        const rows = await query(
            `SELECT MAX(CAST(device_id AS UNSIGNED)) as max_code FROM devices WHERE device_id REGEXP '^[0-9]{6}$'`
        );
        const maxCode = rows[0]?.max_code || 0;
        const nextCode = maxCode + 1;
        if (nextCode > 999999) {
            return res.status(500).json({ error: '设备ID已用尽（超过999999）' });
        }
        const code = String(nextCode).padStart(6, '0');
        res.json({ code });
    } catch (err) {
        console.error('生成设备ID失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 补全所有缺失 device_id 的设备（按 id 升序分配6位码）
app.post('/api/devices/backfill-codes', async (req, res) => {
    try {
        // 查出所有 device_id 为 NULL 的设备，按 id 升序
        const nullDevices = await query(
            `SELECT id FROM devices WHERE device_id IS NULL OR device_id = '' ORDER BY id ASC`
        );
        if (nullDevices.length === 0) {
            return res.json({ message: '所有设备已有设备ID码，无需补全', updated: 0 });
        }

        // 找到当前最大的6位数字码
        const maxRows = await query(
            `SELECT MAX(CAST(device_id AS UNSIGNED)) as max_code FROM devices WHERE device_id REGEXP '^[0-9]{6}$'`
        );
        let nextCode = (maxRows[0]?.max_code || 0) + 1;

        let count = 0;
        for (const device of nullDevices) {
            if (nextCode > 999999) {
                break;
            }
            const code = String(nextCode).padStart(6, '0');
            await query(`UPDATE devices SET device_id=? WHERE id=?`, [code, device.id]);
            nextCode++;
            count++;
        }

        res.json({ message: `已为 ${count} 台设备补全设备ID码`, updated: count });
    } catch (err) {
        console.error('补全设备ID码失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 获取所有设备（或按仓库筛选）
app.get('/api/devices', async (req, res) => {
    try {
        const { warehouseId, warehouseName } = req.query;
        
        let sql = 'SELECT * FROM devices';
        let params = [];
        
        if (warehouseId && warehouseId !== '0') {
            const wh = await query('SELECT name FROM warehouses WHERE id=?', [warehouseId]);
            if (wh.length > 0) {
                sql += ' WHERE warehouse_name=?';
                params = [wh[0].name];
            }
        } else if (warehouseName) {
            sql += ' WHERE warehouse_name=?';
            params = [warehouseName];
        }
        
        sql += ' ORDER BY id';
        
        const result = params.length > 0
            ? await query(sql, params)
            : await query(sql);
        
        res.json(result);
    } catch (err) {
        console.error('获取设备列表失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ 临期设备 API（用于侧边栏临期列表）============
app.get('/api/devices/expiring', async (req, res) => {
    try {
        const sql = `SELECT id, device_id, name, expiry_date, location_status, DATEDIFF(expiry_date, CURDATE()) AS remaining_days
            FROM devices
            WHERE expiry_date IS NOT NULL
            AND expiry_date >= CURDATE()
            ORDER BY remaining_days ASC
            LIMIT 10`;
        const result = await query(sql);
        res.json(result);
    } catch (err) {
        console.error('获取临期设备失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 获取单个设备详情
app.get('/api/devices/:id', async (req, res) => {
    try {
        const device = await query('SELECT * FROM devices WHERE id=?', [req.params.id]);
        
        if (device.length === 0) {
            return res.status(404).json({ error: '设备不存在' });
        }
        
        res.json(device[0]);
    } catch (err) {
        console.error('获取设备详情失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 通过设备ID码（6位码）获取设备详情
app.get('/api/devices/by-code/:code', async (req, res) => {
    try {
        const device = await query('SELECT * FROM devices WHERE device_id=?', [req.params.code]);

        if (device.length === 0) {
            return res.status(404).json({ error: '设备不存在' });
        }

        res.json(device[0]);
    } catch (err) {
        console.error('通过设备ID码获取详情失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 添加设备
app.post('/api/devices', async (req, res) => {
    try {
        const { device_id, warehouseName, name, tag_names, tag_name, status, quantity, storage_location, remark, location_status, destination, checkin_time, expiry_date, responsible_person, department_path, serial_number, spec_model, source } = req.body;
        
        if (!name) return res.status(400).json({ error: '设备名称不能为空' });
        if (!warehouseName) return res.status(400).json({ error: '请选择仓库' });
        
        const locStatus = location_status || 'in_stock';
        const checkinTime = checkin_time || (locStatus === 'in_stock' ? new Date().toISOString() : null);
        // 兼容旧版 tag_name，新版用 tag_names（逗号分隔多标签）
        const tags = tag_names || tag_name || '';
        
        // 如果没有传 device_id，自动生成一个
        let finalDeviceId = device_id || null;
        if (!finalDeviceId) {
            const maxRows = await query(
                `SELECT MAX(CAST(device_id AS UNSIGNED)) as max_code FROM devices WHERE device_id REGEXP '^[0-9]{6}$'`
            );
            const maxCode = maxRows[0]?.max_code || 0;
            const nextCode = maxCode + 1;
            if (nextCode > 999999) {
                return res.status(500).json({ error: '设备ID已用尽（超过999999）' });
            }
            finalDeviceId = String(nextCode).padStart(6, '0');
        }

        const result = await query(
            `INSERT INTO devices (device_id, warehouse_name, name, tag_names, status, quantity, storage_location, location_status, destination, remark, expiry_date, checkin_time, responsible_person, department_path, serial_number, spec_model, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [finalDeviceId, warehouseName, name, tags, status || '正常', quantity || 1, storage_location || '', locStatus, destination || '', remark || '', expiry_date || null, checkinTime, responsible_person || null, department_path || null, serial_number || null, spec_model || null, source || null]
        );
        
        res.json({ id: result.insertId, warehouseName, name });
    } catch (err) {
        console.error('添加设备失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 更新设备（支持部分更新：只更新请求中实际携带的字段）
app.put('/api/devices/:id', async (req, res) => {
    try {
        // 字段映射：请求体 key → 数据库列名 → 默认值处理函数
        const fieldMap = [
            { key: 'device_id',       col: 'device_id',         fn: v => v || null },
            { key: 'warehouseName',   col: 'warehouse_name',    fn: v => v },
            { key: 'name',            col: 'name',              fn: v => v },
            { key: 'tag_names',       col: 'tag_names',         fn: v => v || req.body.tag_name || '' },
            { key: 'tag_name',        col: 'tag_names',         fn: v => v || req.body.tag_names || '' },
            { key: 'status',          col: 'status',            fn: v => v },
            { key: 'quantity',        col: 'quantity',          fn: v => v || 1 },
            { key: 'storage_location',col: 'storage_location',  fn: v => v || '' },
            { key: 'location_status', col: 'location_status',   fn: v => v || 'in_stock' },
            { key: 'destination',     col: 'destination',       fn: v => v || '' },
            { key: 'remark',          col: 'remark',            fn: v => v || '' },
            { key: 'expiry_date',     col: 'expiry_date',       fn: v => v || null },
            { key: 'checkin_time',    col: 'checkin_time',      fn: v => v || null },
            { key: 'checkout_time',   col: 'checkout_time',     fn: v => v || null },
            { key: 'responsible_person', col: 'responsible_person', fn: v => v || null },
            { key: 'department_path',   col: 'department_path',   fn: v => v || null },
            { key: 'serial_number',     col: 'serial_number',     fn: v => v || null },
            { key: 'spec_model',        col: 'spec_model',        fn: v => v || null },
            { key: 'source',            col: 'source',            fn: v => v || null },

        // 只包含 req.body 中实际存在的字段（排除 undefined）
        const setClauses = [];
        const values = [];

        for (const { key, col, fn } of fieldMap) {
            if (key in req.body && req.body[key] !== undefined) {
                // 跳过 tag_name 如果 tag_names 已处理（避免重复）
                if (key === 'tag_name' && 'tag_names' in req.body && req.body.tag_names !== undefined) continue;
                setClauses.push(`${col}=?`);
                values.push(fn(req.body[key]));
            }
        }

        // 如果没有要更新的字段，至少也需要 updated_at
        if (setClauses.length === 0) {
            return res.status(400).json({ error: '没有提供要更新的字段' });
        }

        // 始终更新 updated_at
        setClauses.push('updated_at=CURRENT_TIMESTAMP');
        values.push(req.params.id);

        const sql = `UPDATE devices SET ${setClauses.join(', ')} WHERE id=?`;
        console.log('[PUT /api/devices/:id] 部分更新 SQL:', sql, values);

        await query(sql, values);

        res.json({ id: req.params.id, updatedFields: Object.keys(req.body).filter(k => req.body[k] !== undefined) });
    } catch (err) {
        console.error('更新设备失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 删除设备
app.delete('/api/devices/:id', async (req, res) => {
    try {
        await query('DELETE FROM devices WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ 标签统计 API（用于侧边栏）============
app.get('/api/tag-stats', async (req, res) => {
    try {
        const { warehouseName } = req.query;
        
        // 获取设备和 tag_names，在应用层拆分多标签后聚合
        let sql = `SELECT tag_names, quantity FROM devices WHERE tag_names IS NOT NULL AND tag_names != ''`;
        let params = [];
        
        if (warehouseName) {
            sql += ' AND warehouse_name=?';
            params = [warehouseName];
        }
        
        const rows = await query(sql, params);
        
        // 拆分 JSON 数组格式的标签并聚合
        const tagCountMap = {};
        rows.forEach(row => {
            if (row.tag_names) {
                let tags = [];
                try {
                    tags = JSON.parse(row.tag_names);
                } catch (e) {
                    // 兼容旧的逗号分隔格式
                    tags = row.tag_names.split(',').map(t => t.trim()).filter(t => t);
                }
                tags.forEach(tag => {
                    const name = tag.trim();
                    if (name) {
                        if (!tagCountMap[name]) {
                            tagCountMap[name] = { name, device_count: 0, total_count: 0 };
                        }
                        tagCountMap[name].device_count += 1;
                        tagCountMap[name].total_count += row.quantity || 1;
                    }
                });
            }
        });
        
        const result = Object.values(tagCountMap).sort((a, b) => b.total_count - a.total_count);
        
        res.json(result);
    } catch (err) {
        console.error('获取标签统计失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ 公告 API ============

// 获取所有公告
app.get('/api/announcements', async (req, res) => {
    try {
        const announcements = await query('SELECT * FROM announcements ORDER BY created_at DESC');
        res.json({ success: true, data: announcements });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 添加公告
app.post('/api/announcements', async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) {
            return res.status(400).json({ success: false, error: '公告内容不能为空' });
        }

        // 获取北京时间（UTC+8）
        const now = new Date();
        const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const beijingTimeStr = beijingTime.toISOString().slice(0, 19).replace('T', ' ');

        const result = await query(
            'INSERT INTO announcements (content, created_at) VALUES (?, ?)',
            [content, beijingTimeStr]
        );

        const announcements = await query('SELECT * FROM announcements WHERE id=?', [result.insertId]);
        res.json({ success: true, data: announcements[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// 删除公告
app.delete('/api/announcements/:id', async (req, res) => {
    try {
        await query('DELETE FROM announcements WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 公开配置（S3 URL 等，前端动态读取）
app.get('/api/config', (req, res) => {
    res.json({
        s3PublicUrl: s3Config.publicUrl || `${s3Config.endpoint}/${s3Config.bucket}`,
    });
});

// ============ 图片上传 API（S3） ============

// 上传图片到 S3
app.post('/api/upload/image', upload.single('image'), async (req, res) => {
    try {
        const { deviceId } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: '请选择图片文件' });
        }
        if (!deviceId) {
            return res.status(400).json({ error: '缺少 deviceId 参数' });
        }

        // 生成唯一文件名：时间戳_随机6位.原始扩展名
        const ext = path.extname(file.originalname).toLowerCase() || '.png';
        const filename = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
        const s3Key = `${s3Config.basePrefix}images/${deviceId}/${filename}`;

        console.log(`[S3上传] 开始上传: ${s3Key}, 大小: ${file.buffer.length} 字节, 类型: ${file.mimetype}`);

        // 上传到 S3
        const putResult = await s3.send(new PutObjectCommand({
            Bucket: s3Config.bucket,
            Key: s3Key,
            Body: file.buffer,
            ContentType: file.mimetype,
        }));

        console.log(`[S3上传] PutObject 响应: HTTP ${putResult.$metadata.httpStatusCode}`);

        // ★ 上传后验证：用 HeadObject 确认文件已落盘，防止假成功
        try {
            await s3.send(new HeadObjectCommand({
                Bucket: s3Config.bucket,
                Key: s3Key,
            }));
            console.log(`[S3上传] HeadObject 验证通过: ${s3Key}`);
        } catch (headErr) {
            console.error(`[S3上传] HeadObject 验证失败: ${s3Key}, 可能未成功落盘:`, headErr.message);
            return res.status(500).json({ error: '图片上传后验证失败，请重试' });
        }

        // bucket 未开公开读，返回代理路径而非 S3 直链
        const imageUrl = `/api/images/${deviceId}/${filename}`;

        console.log(`[S3上传] 完成: ${s3Key}`);
        res.json({ success: true, url: imageUrl, key: s3Key });
    } catch (err) {
        console.error('[S3] 上传失败:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ============ S3 图片管理 API（必须在 :deviceId/:filename 之前，否则会被代理路由拦截） ============

// 列出指定设备文件夹下的所有图片
app.get('/api/images/list/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const prefix = `${s3Config.basePrefix}images/${deviceId}/`;

        console.log(`[S3列表] 查询目录: ${prefix}`);

        const command = new ListObjectsV2Command({
            Bucket: s3Config.bucket,
            Prefix: prefix,
            MaxKeys: 500,
        });

        const response = await s3.send(command);

        const images = (response.Contents || [])
            .filter(item => !item.Key.endsWith('/')) // 排除目录占位
            .map(item => {
                const filename = item.Key.replace(prefix, '');
                return {
                    filename,
                    key: item.Key,
                    size: item.Size,
                    lastModified: item.LastModified,
                    url: `/api/images/${deviceId}/${filename}`,
                };
            });

        console.log(`[S3列表] 找到 ${images.length} 个文件`);
        res.json({ success: true, images });
    } catch (err) {
        console.error('[S3列表] 失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 删除 S3 中的指定图片
app.delete('/api/images/:deviceId/:filename', async (req, res) => {
    try {
        const { deviceId, filename } = req.params;
        const s3Key = `${s3Config.basePrefix}images/${deviceId}/${filename}`;

        console.log(`[S3删除] 删除: ${s3Key}`);

        await s3.send(new DeleteObjectCommand({
            Bucket: s3Config.bucket,
            Key: s3Key,
        }));

        console.log(`[S3删除] 成功: ${s3Key}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[S3删除] 失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 图片代理：通过服务器中转访问 S3（解决 bucket 私有问题）
// ★ 使用流式传输：边从 S3 下载边发给浏览器，大图片不再需要等整个文件缓冲完才开始传输
app.get('/api/images/:deviceId/:filename', async (req, res) => {
    try {
        const { deviceId, filename } = req.params;
        const s3Key = `${s3Config.basePrefix}images/${deviceId}/${filename}`;

        console.log(`[S3代理] 请求图片: ${s3Key}`);

        const getCommand = new GetObjectCommand({
            Bucket: s3Config.bucket,
            Key: s3Key,
        });

        const s3Response = await s3.send(getCommand);

        // 设置响应头（必须在流式传输前设置）
        if (s3Response.ContentType) {
            res.set('Content-Type', s3Response.ContentType);
        } else {
            const ext = path.extname(filename).toLowerCase();
            const mimeMap = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
            };
            res.set('Content-Type', mimeMap[ext] || 'application/octet-stream');
        }
        if (s3Response.ContentLength) {
            res.set('Content-Length', s3Response.ContentLength.toString());
        }
        // 文件名含时间戳，内容永不变化，可大胆缓存 + immutable 避免 revalidation
        res.set('Cache-Control', 'public, max-age=86400, immutable');

        console.log(`[S3代理] 流式返回图片: ${s3Key}${s3Response.ContentLength ? ', 大小: ' + s3Response.ContentLength + ' 字节' : ''}`);

        // 逐块写入：兼容 Node.js Readable 和 Web Stream，边下边发（不缓冲整个文件）
        const stream = s3Response.Body;
        try {
            for await (const chunk of stream) {
                res.write(chunk);
            }
            res.end();
        } catch (streamErr) {
            console.error(`[S3代理] 流读取错误: ${s3Key}`, streamErr.message);
            if (!res.headersSent) {
                res.status(500).json({ error: '图片读取失败' });
            } else {
                res.end();
            }
        }
    } catch (err) {
        console.error('[S3] 代理读取失败:', err.name, err.message, err.$metadata);
        if (!res.headersSent) {
            if (err.name === 'NoSuchKey') {
                return res.status(404).json({ error: '图片不存在' });
            }
            res.status(500).json({ error: err.message });
        }
    }
});

// 诊断：检查 S3 中图片是否存在
app.get('/api/test/image-check/:deviceId/:filename', async (req, res) => {
    try {
        const { deviceId, filename } = req.params;
        const s3Key = `${s3Config.basePrefix}images/${deviceId}/${filename}`;
        const proxyUrl = `/api/images/${deviceId}/${filename}`;

        let info = {
            s3Key,
            proxyUrl: `http://localhost:${PORT}${proxyUrl}`,
            exists: false,
            error: null,
            size: 0,
            contentType: null,
        };

        try {
            const s3Response = await s3.send(new GetObjectCommand({
                Bucket: s3Config.bucket,
                Key: s3Key,
            }));
            const chunks = [];
            for await (const chunk of s3Response.Body) {
                chunks.push(chunk);
            }
            const buffer = Buffer.concat(chunks);
            info.exists = true;
            info.size = buffer.length;
            info.contentType = s3Response.ContentType || '未知';
        } catch (err) {
            info.error = err.name + ': ' + err.message;
        }

        res.json(info);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ 附件管理 API ============

// 列出附件
app.get('/api/attachments/:deviceId', async (req, res) => {
    try {
        const { deviceId } = req.params;
        if (!deviceId || deviceId === '0') {
            return res.json({ success: true, attachments: [] });
        }

        const prefix = `${s3Config.basePrefix}attachments/${deviceId}/`;
        console.log(`[S3附件列表] 查询: ${prefix}`);

        const command = new ListObjectsV2Command({
            Bucket: s3Config.bucket,
            Prefix: prefix,
            MaxKeys: 100,
        });

        const response = await s3.send(command);

        const attachments = (response.Contents || [])
            .filter(item => !item.Key.endsWith('/'))
            .map(item => {
                const key = item.Key;
                const filename = key.replace(prefix, '');
                // URL 中编码文件名，确保浏览器正确处理
                const url = `/api/attachments/${deviceId}/${encodeURIComponent(filename)}`;
                // 提取原始文件名（去掉前14位时间戳+下划线+6位随机+下划线前缀）
                const match = filename.match(/^\d+_[a-f0-9]{6}_(.+)$/);
                const displayName = match ? match[1] : filename;
                return {
                    filename,
                    displayName,
                    key,
                    size: item.Size,
                    lastModified: item.LastModified,
                    url,
                };
            });

        console.log(`[S3附件列表] 找到 ${attachments.length} 个文件`);
        res.json({ success: true, attachments });
    } catch (err) {
        console.error('[S3附件列表] 失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 删除附件
app.delete('/api/attachments/:deviceId/:filename', async (req, res) => {
    try {
        const { deviceId, filename } = req.params;
        const s3Key = `${s3Config.basePrefix}attachments/${deviceId}/${filename}`;

        console.log(`[S3附件删除] 删除: ${s3Key}`);

        await s3.send(new DeleteObjectCommand({
            Bucket: s3Config.bucket,
            Key: s3Key,
        }));

        console.log(`[S3附件删除] 成功: ${s3Key}`);
        res.json({ success: true });
    } catch (err) {
        console.error('[S3附件删除] 失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 修复 multer/busboy latin1 解析中文文件名 bug
function fixOriginalName(name) {
    // 1. 如果已含 CJK 字符，说明 busboy 已正确解码
    if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(name)) return name;
    // 2. 尝试 latin1→utf8 反转，仅在结果含 CJK 时才采用（避免破坏 café/æble 等非中文文件名）
    try {
        const decoded = Buffer.from(name, 'latin1').toString('utf8');
        if (/[\u4e00-\u9fff]/.test(decoded)) return decoded;
    } catch (_) {}
    return name;
}

// 上传附件
app.post('/api/upload/attachment', uploadAttachment.single('attachment'), async (req, res) => {
    try {
        const { deviceId } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: '请选择附件文件' });
        if (!deviceId) return res.status(400).json({ error: '缺少 deviceId 参数' });

        const originalName = fixOriginalName(file.originalname).trim();
        const ext = path.extname(originalName).toLowerCase();
        const baseName = ext
            ? originalName.slice(0, originalName.length - ext.length).replace(/[\/\\:*?"<>|#]/g, '_').substring(0, 200)
            : originalName.replace(/[\/\\:*?"<>|#]/g, '_').substring(0, 200);
        const filename = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}_${baseName}${ext}`;
        const s3Key = `${s3Config.basePrefix}attachments/${deviceId}/${filename}`;

        console.log(`[S3附件上传] 原名: ${originalName}, S3Key: ${s3Key}, 大小: ${file.buffer.length} 字节`);

        await s3.send(new PutObjectCommand({
            Bucket: s3Config.bucket,
            Key: s3Key,
            Body: file.buffer,
            ContentType: file.mimetype || 'application/octet-stream',
        }));

        // ★ 上传后验证：用 HeadObject 确认文件已落盘，防止假成功
        try {
            await s3.send(new HeadObjectCommand({
                Bucket: s3Config.bucket,
                Key: s3Key,
            }));
            console.log(`[S3附件上传] HeadObject 验证通过: ${s3Key}`);
        } catch (headErr) {
            console.error(`[S3附件上传] HeadObject 验证失败: ${s3Key}, 可能未成功落盘:`, headErr.message);
            return res.status(500).json({ error: '附件上传后验证失败，请重试' });
        }

        const url = `/api/attachments/${deviceId}/${encodeURIComponent(filename)}`;

        console.log(`[S3附件上传] 完成: ${s3Key}`);
        res.json({
            success: true,
            url,
            key: s3Key,
            filename,
            originalName,
            size: file.size,
        });
    } catch (err) {
        console.error('[S3附件上传] 失败:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 附件代理：通过服务器中转访问 S3
app.get('/api/attachments/:deviceId/:filename', async (req, res) => {
    try {
        const { deviceId, filename } = req.params;
        const s3Key = `${s3Config.basePrefix}attachments/${deviceId}/${filename}`;

        console.log(`[S3附件代理] 请求: ${s3Key}`);

        const s3Response = await s3.send(new GetObjectCommand({
            Bucket: s3Config.bucket,
            Key: s3Key,
        }));

        const chunks = [];
        for await (const chunk of s3Response.Body) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // Markdown 文件转 HTML 预览
        if (/\.md$/i.test(filename)) {
            const mdContent = buffer.toString('utf8');
            const htmlContent = marked.parse(mdContent);
            const page = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${filename.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</title>
<style>
    body { max-width: 860px; margin: 40px auto; padding: 0 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.7; color: #24292e; }
    h1, h2 { border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
    code { background: #f6f8fa; padding: 2px 6px; border-radius: 3px; font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 13px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #dfe2e5; padding: 8px 12px; text-align: left; }
    th { background: #f6f8fa; }
    blockquote { border-left: 4px solid #dfe2e5; padding: 0 16px; color: #6a737d; margin: 0; }
    img { max-width: 100%; }
</style>
</head>
<body>${htmlContent}</body>
</html>`;
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.set('Content-Length', Buffer.byteLength(page).toString());
            return res.end(page);
        }

        res.set('Content-Type', s3Response.ContentType || 'application/octet-stream');
        res.set('Content-Length', buffer.length.toString());
        res.set('Cache-Control', 'public, max-age=86400');
        // inline 优先预览（PDF/图片/文本等浏览器能直接渲染），不支持的格式浏览器会自动下载
        res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);

        res.end(buffer);
    } catch (err) {
        console.error('[S3附件代理] 失败:', err.name, err.message);
        if (err.name === 'NoSuchKey') {
            return res.status(404).json({ error: '附件不存在' });
        }
        res.status(500).json({ error: err.message });
    }
});

// 静态文件服务（放在最后以避免与API路由冲突）
app.use(express.static(path.join(__dirname, '../public')));

// 根路径返回 index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 启动服务
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 设备管理系统已启动: http://localhost:${PORT}`);
});
