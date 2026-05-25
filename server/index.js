const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const path = require('path');
const { active, dbConfig } = require('./db.config');

const app = express();
const PORT = 3000;

// MySQL 连接配置
const pool = mysql.createPool({
    ...dbConfig,
    connectionLimit: 10,
    connectTimeout: 10000, // 连接超时 10秒
    acquireTimeout: 10000 // 获取连接超时 10秒
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

// 封装查询函数
const query = (sql, values = []) => {
    return new Promise((resolve, reject) => {
        pool.query(sql, values, (err, results) => {
            if (err) reject(err);
            else resolve(results);
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

// 添加设备
app.post('/api/devices', async (req, res) => {
    try {
        const { device_id, warehouseName, name, tag_names, tag_name, status, quantity, storage_location, remark, location_status, destination, checkin_time, expiry_date, responsible_person } = req.body;
        
        if (!name) return res.status(400).json({ error: '设备名称不能为空' });
        if (!warehouseName) return res.status(400).json({ error: '请选择仓库' });
        
        const locStatus = location_status || 'in_stock';
        const checkinTime = checkin_time || (locStatus === 'in_stock' ? new Date().toISOString() : null);
        // 兼容旧版 tag_name，新版用 tag_names（逗号分隔多标签）
        const tags = tag_names || tag_name || '';
        
        const result = await query(
            `INSERT INTO devices (device_id, warehouse_name, name, tag_names, status, quantity, storage_location, location_status, destination, remark, expiry_date, checkin_time, responsible_person) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [device_id || null, warehouseName, name, tags, status || '正常', quantity || 1, storage_location || '', locStatus, destination || '', remark || '', expiry_date || null, checkinTime, responsible_person || null]
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
        ];

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
