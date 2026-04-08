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
    ...dbConfig[active],
    connectionLimit: 10,
    connectTimeout: 10000, // 连接超时 10秒
    acquireTimeout: 10000 // 获取连接超时 10秒
});

// 测试连接
pool.getConnection((err, connection) => {
    if (err) {
        console.error(`MySQL [${active}] 连接失败:`, err.message);
    } else {
        console.log(`✅ MySQL [${active}] 连接成功`);
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

// ============ 标签 API ============

// 获取所有标签列表（带统计）
app.get('/api/tags', async (req, res) => {
    try {
        console.log('正在获取标签列表...');
        
        // 先获取基本标签信息
        const tags = await query('SELECT id, name FROM tags ORDER BY name');
        console.log('获取到标签数量:', tags.length);
        
        // 为每个标签添加统计信息
        const tagsWithStats = await Promise.all(tags.map(async (tag) => {
            try {
                // 获取设备数量
                const deviceCountResult = await query(`
                    SELECT COUNT(DISTINCT device_id) as device_count,
                           COALESCE(SUM(d.quantity), 0) as total_quantity
                    FROM device_tags dt
                    LEFT JOIN devices d ON dt.device_id = d.id
                    WHERE dt.tag_id = ?
                `, [tag.id]);
                
                const deviceCount = deviceCountResult[0]?.device_count || 0;
                const totalQuantity = deviceCountResult[0]?.total_quantity || 0;
                
                // 获取仓库数量
                const warehouseCountResult = await query(`
                    SELECT COUNT(DISTINCT d.warehouse_name) as warehouse_count
                    FROM device_tags dt
                    LEFT JOIN devices d ON dt.device_id = d.id
                    WHERE dt.tag_id = ?
                `, [tag.id]);
                
                const warehouseCount = warehouseCountResult[0]?.warehouse_count || 0;
                
                return {
                    ...tag,
                    device_count: deviceCount,
                    total_quantity: totalQuantity,
                    warehouse_count: warehouseCount
                };
            } catch (err) {
                console.error(`获取标签 ${tag.id} (${tag.name}) 统计信息失败:`, err.message);
                // 如果统计查询失败，返回基本标签信息
                return {
                    ...tag,
                    device_count: 0,
                    total_quantity: 0,
                    warehouse_count: 0
                };
            }
        }));
        
        res.json(tagsWithStats);
    } catch (err) {
        console.error('获取标签列表失败:', err);
        // 如果连基本标签查询都失败，尝试返回简单列表
        try {
            const simpleTags = await query('SELECT id, name FROM tags ORDER BY name');
            const tagsWithDefaults = simpleTags.map(tag => ({
                ...tag,
                device_count: 0,
                total_quantity: 0,
                warehouse_count: 0
            }));
            res.json(tagsWithDefaults);
        } catch (fallbackErr) {
            console.error('回退查询也失败:', fallbackErr);
            res.status(500).json({ error: err.message });
        }
    }
});

// 添加标签
app.post('/api/tags', async (req, res) => {
    try {
        const { name } = req.body;
        const result = await query('INSERT INTO tags (name) VALUES (?)', [name]);
        res.json({ id: result.insertId, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 更新标签
app.put('/api/tags/:id', async (req, res) => {
    try {
        const { name } = req.body;
        await query('UPDATE tags SET name=? WHERE id=?', [name, req.params.id]);
        res.json({ id: req.params.id, name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 删除标签
app.delete('/api/tags/:id', async (req, res) => {
    try {
        await query('DELETE FROM tags WHERE id=?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ 设备标签关系 API ============

// 获取设备的所有标签
app.get('/api/device-tags', async (req, res) => {
    try {
        const { device_id } = req.query;
        
        if (!device_id) {
            return res.status(400).json({ error: '缺少设备ID参数' });
        }
        
        const deviceTags = await query(`
            SELECT dt.*, t.name as tag_name 
            FROM device_tags dt
            LEFT JOIN tags t ON dt.tag_id = t.id
            WHERE dt.device_id = ?
        `, [device_id]);
        
        res.json(deviceTags);
    } catch (err) {
        console.error('获取设备标签失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 添加设备标签关系
app.post('/api/device-tags', async (req, res) => {
    try {
        const { device_id, tag_id } = req.body;
        
        if (!device_id || !tag_id) {
            return res.status(400).json({ error: '缺少设备ID或标签ID' });
        }
        
        // 检查是否已存在
        const existing = await query(
            'SELECT * FROM device_tags WHERE device_id = ? AND tag_id = ?',
            [device_id, tag_id]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ error: '该标签已添加到设备' });
        }
        
        const result = await query(
            'INSERT INTO device_tags (device_id, tag_id) VALUES (?, ?)',
            [device_id, tag_id]
        );
        
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('添加设备标签失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 删除设备标签关系
app.delete('/api/device-tags', async (req, res) => {
    try {
        const { device_id, tag_id } = req.query;
        
        if (!device_id || !tag_id) {
            return res.status(400).json({ error: '缺少设备ID或标签ID' });
        }
        
        await query(
            'DELETE FROM device_tags WHERE device_id = ? AND tag_id = ?',
            [device_id, tag_id]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('删除设备标签失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ 设备 API ============

// 获取所有设备（或按仓库筛选）
app.get('/api/devices', async (req, res) => {
    try {
        const { warehouseId, warehouseName } = req.query;
        
        // 先获取仓库名称
        let warehouse = null;
        if (warehouseId && warehouseId !== '0') {
            const wh = await query('SELECT name FROM warehouses WHERE id=?', [warehouseId]);
            warehouse = wh.length > 0 ? wh[0].name : null;
        } else if (warehouseName) {
            warehouse = warehouseName;
        }
        
        // 先获取设备列表（不包含标签，避免 GROUP_CONCAT 问题）
        let sql = `
            SELECT d.*, w.name as warehouse_name
            FROM devices d
            LEFT JOIN warehouses w ON d.warehouse_name = w.name
        `;
        
        let devices;
        if (warehouse) {
            sql += ' WHERE d.warehouse_name=? ORDER BY d.id';
            devices = await query(sql, [warehouse]);
        } else {
            sql += ' ORDER BY d.id';
            devices = await query(sql);
        }
        
        // 一次性获取所有标签关系
        const tagRelations = await query(`
            SELECT dt.device_id, t.id as tag_id, t.name as tag_name
            FROM device_tags dt
            LEFT JOIN tags t ON dt.tag_id = t.id
            ORDER BY dt.device_id, t.name
        `);
        
        // 在内存中合并标签数据
        const deviceMap = new Map();
        devices.forEach(d => {
            deviceMap.set(d.id, { ...d, tags: [], tagIds: [] });
        });
        
        tagRelations.forEach(tr => {
            if (deviceMap.has(tr.device_id)) {
                const device = deviceMap.get(tr.device_id);
                device.tags.push(tr.tag_name);
                device.tagIds.push(String(tr.tag_id));
            }
        });
        
        // 构建返回数据
        const result = Array.from(deviceMap.values()).map(device => ({
            ...device,
            tag_name: device.tags[0] || null
        }));
        
        res.json(result);
    } catch (err) {
        console.error('获取设备列表失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 获取单个设备详情
app.get('/api/devices/:id', async (req, res) => {
    try {
        const device = await query(`
            SELECT d.*, w.name as warehouse_name
            FROM devices d
            LEFT JOIN warehouses w ON d.warehouse_name = w.name
            WHERE d.id=?
        `, [req.params.id]);
        
        if (device.length === 0) {
            return res.status(404).json({ error: '设备不存在' });
        }
        
        const deviceData = device[0];
        
        // 获取设备标签
        try {
            const tagsResult = await query(`
                SELECT t.id, t.name
                FROM device_tags dt
                LEFT JOIN tags t ON dt.tag_id = t.id
                WHERE dt.device_id = ?
            `, [req.params.id]);
            
            const tags = tagsResult.map(row => row.name);
            const tagIds = tagsResult.map(row => row.id);
            
            res.json({
                ...deviceData,
                tags,  // 标签名称数组
                tagIds // 标签ID数组
            });
        } catch (tagErr) {
            console.error(`获取设备 ${req.params.id} 标签失败:`, tagErr.message);
            res.json({
                ...deviceData,
                tags: [],
                tagIds: []
            });
        }
    } catch (err) {
        console.error('获取设备详情失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 添加设备
app.post('/api/devices', async (req, res) => {
    try {
        const { warehouseId, warehouseName, name, tagIds = [], status, quantity, storage_location, remark, location_status, destination } = req.body;
        
        // 获取仓库名称
        let whName = warehouseName;
        if (!whName && warehouseId) {
            const wh = await query('SELECT name FROM warehouses WHERE id=?', [warehouseId]);
            whName = wh.length > 0 ? wh[0].name : null;
        }
        
        if (!whName) {
            return res.status(400).json({ error: '请选择仓库' });
        }
        
        // 设置入库时间
        const locStatus = location_status || 'in_stock';
        const checkinTime = locStatus === 'in_stock' ? new Date() : null;
        
        const result = await query(
            'INSERT INTO devices (warehouse_name, name, status, quantity, storage_location, location_status, destination, remark, checkin_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [whName, name, status || '正常', quantity || 1, storage_location || '', locStatus, destination || '', remark || '', checkinTime]
        );
        
        const deviceId = result.insertId;
        
        // 处理标签
        if (Array.isArray(tagIds) && tagIds.length > 0) {
            for (const tagId of tagIds) {
                try {
                    await query(
                        'INSERT INTO device_tags (device_id, tag_id) VALUES (?, ?)',
                        [deviceId, tagId]
                    );
                } catch (tagErr) {
                    console.error(`添加标签关系失败 device_id=${deviceId}, tag_id=${tagId}:`, tagErr.message);
                    // 继续处理其他标签，不中断
                }
            }
        }
        
        res.json({ 
            id: deviceId, 
            warehouseName: whName, 
            name, 
            storage_location: storage_location || '',
            status: status || '正常', 
            quantity: quantity || 1, 
            remark: remark || ''
        });
    } catch (err) {
        console.error('添加设备失败:', err);
        res.status(500).json({ error: err.message });
    }
});

// 更新设备
app.put('/api/devices/:id', async (req, res) => {
    try {
        const { warehouseName, name, tagIds = [], status, quantity, storage_location, remark, location_status, destination, checkin_time, checkout_time } = req.body;
        
        // 将 ISO 格式时间转换为 MySQL datetime 格式
        function formatDateTimeForMySQL(dateStr) {
            if (!dateStr || dateStr === null) return null;
            // 如果是 ISO 格式 (2026-03-20T02:03:43.178Z)，转换为 MySQL 格式
            if (dateStr.includes('T')) {
                const d = new Date(dateStr);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                const hours = String(d.getHours()).padStart(2, '0');
                const minutes = String(d.getMinutes()).padStart(2, '0');
                const seconds = String(d.getSeconds()).padStart(2, '0');
                return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            }
            return dateStr;
        }
        
        const checkinTime = formatDateTimeForMySQL(checkin_time);
        const checkoutTime = formatDateTimeForMySQL(checkout_time);
        
        // 更新设备基本信息
        await query(
            'UPDATE devices SET warehouse_name=?, name=?, status=?, quantity=?, storage_location=?, location_status=?, destination=?, remark=?, checkin_time=?, checkout_time=? WHERE id=?',
            [warehouseName, name, status, quantity, storage_location || '', location_status || 'in_stock', destination || '', remark, checkinTime, checkoutTime, req.params.id]
        );
        
        // 删除现有的设备标签关系
        await query('DELETE FROM device_tags WHERE device_id = ?', [req.params.id]);
        
        // 添加新的标签关系
        if (Array.isArray(tagIds) && tagIds.length > 0) {
            for (const tagId of tagIds) {
                try {
                    await query(
                        'INSERT INTO device_tags (device_id, tag_id) VALUES (?, ?)',
                        [req.params.id, tagId]
                    );
                } catch (tagErr) {
                    console.error(`更新标签关系失败 device_id=${req.params.id}, tag_id=${tagId}:`, tagErr.message);
                    // 继续处理其他标签
                }
            }
        }
        
        res.json({ id: req.params.id, warehouseName, name, status, quantity, storage_location, remark });
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
        
        // 获取所有标签
        const tags = await query('SELECT id, name FROM tags ORDER BY name');
        
        // 为每个标签计算统计信息
        const tagStats = await Promise.all(tags.map(async (tag) => {
            try {
                let deviceSql = `
                    SELECT COUNT(DISTINCT dt.device_id) as device_count,
                           COALESCE(SUM(d.quantity), 0) as total_count,
                           COUNT(DISTINCT d.warehouse_name) as warehouse_count
                    FROM device_tags dt
                    LEFT JOIN devices d ON dt.device_id = d.id
                    WHERE dt.tag_id = ?
                `;
                
                let deviceParams = [tag.id];
                
                if (warehouseName) {
                    deviceSql += ' AND d.warehouse_name = ?';
                    deviceParams.push(warehouseName);
                }
                
                const statsResult = await query(deviceSql, deviceParams);
                
                return {
                    id: tag.id,
                    name: tag.name,
                    device_count: statsResult[0]?.device_count || 0,
                    total_count: statsResult[0]?.total_count || 0,
                    warehouse_count: statsResult[0]?.warehouse_count || 0
                };
            } catch (statsErr) {
                console.error(`计算标签 ${tag.name} 统计信息失败:`, statsErr.message);
                return {
                    id: tag.id,
                    name: tag.name,
                    device_count: 0,
                    total_count: 0,
                    warehouse_count: 0
                };
            }
        }));
        
        // 按总数量降序排序
        const sortedStats = tagStats.sort((a, b) => b.total_count - a.total_count);
        
        res.json(sortedStats);
    } catch (err) {
        console.error('获取标签统计失败:', err);
        // 如果查询失败，返回空统计
        try {
            const simpleTags = await query('SELECT name FROM tags ORDER BY name');
            const emptyStats = simpleTags.map(tag => ({
                name: tag.name,
                device_count: 0,
                total_count: 0,
                warehouse_count: 0
            }));
            res.json(emptyStats);
        } catch (fallbackErr) {
            console.error('回退查询也失败:', fallbackErr);
            res.status(500).json({ error: err.message });
        }
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
