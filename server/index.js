const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const path = require('path');

const app = express();
const PORT = 3000;

// MySQL 连接配置（TiDB Cloud）
const pool = mysql.createPool({
    host: 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: 'WYqCciHtZyezMP6.root',
    password: 'i6sVtriNBwHr4ZCj',
    database: 'DMS',
    ssl: {
        rejectUnauthorized: false
    },
    connectionLimit: 10
});

// 测试连接
pool.getConnection((err, connection) => {
    if (err) {
        console.error('MySQL 连接失败:', err.message);
    } else {
        console.log('✅ MySQL 连接成功');
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
        const tags = await query(`
            SELECT t.id, t.name, 
                   COUNT(DISTINCT dt.device_id) as device_count, 
                   COALESCE(SUM(d.quantity), 0) as total_quantity,
                   COUNT(DISTINCT d.warehouse_name) as warehouse_count
            FROM tags t
            LEFT JOIN device_tags dt ON t.id = dt.tag_id
            LEFT JOIN devices d ON dt.device_id = d.id
            GROUP BY t.id, t.name
            ORDER BY t.name
        `);
        
        res.json(tags);
    } catch (err) {
        res.status(500).json({ error: err.message });
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

// ============ 设备 API ============

// 获取所有设备（或按仓库筛选）
app.get('/api/devices', async (req, res) => {
    try {
        const { warehouseId, warehouseName } = req.query;
        let sql = `
            SELECT d.*, w.name as warehouse_name
            FROM devices d
            LEFT JOIN warehouses w ON d.warehouse_name = w.name
        `;
        let params = [];
        
        if (warehouseId) {
            // 通过仓库ID获取仓库名称
            const wh = await query('SELECT name FROM warehouses WHERE id=?', [warehouseId]);
            if (wh.length > 0) {
                sql += ' WHERE d.warehouse_name=?';
                params = [wh[0].name];
            }
        } else if (warehouseName) {
            sql += ' WHERE d.warehouse_name=?';
            params = [warehouseName];
        }
        
        sql += ' ORDER BY d.id';
        
        const devices = await query(sql, params);
        
        res.json(devices);
    } catch (err) {
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
        
        res.json(device[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 添加设备
app.post('/api/devices', async (req, res) => {
    try {
        const { warehouseId, warehouseName, name, tag_name, status, quantity, storage_location, remark, location_status, destination } = req.body;
        
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
            'INSERT INTO devices (warehouse_name, name, tag_name, status, quantity, storage_location, location_status, destination, remark, checkin_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [whName, name, tag_name || '', status || '正常', quantity || 1, storage_location || '', locStatus, destination || '', remark || '', checkinTime]
        );
        
        res.json({ 
            id: result.insertId, 
            warehouseName: whName, 
            name, 
            tag_name: tag_name || '', 
            storage_location: storage_location || '',
            status: status || '正常', 
            quantity: quantity || 1, 
            remark: remark || ''
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 更新设备
app.put('/api/devices/:id', async (req, res) => {
    try {
        const { warehouseName, name, tag_name, status, quantity, storage_location, remark, location_status, destination, checkin_time, checkout_time } = req.body;
        
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
        
        await query(
            'UPDATE devices SET warehouse_name=?, name=?, tag_name=?, status=?, quantity=?, storage_location=?, location_status=?, destination=?, remark=?, checkin_time=?, checkout_time=? WHERE id=?',
            [warehouseName, name, tag_name || '', status, quantity, storage_location || '', location_status || 'in_stock', destination || '', remark, checkinTime, checkoutTime, req.params.id]
        );
        
        res.json({ id: req.params.id, warehouseName, name, tag_name, status, quantity, storage_location, remark });
    } catch (err) {
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
        let sql = `
            SELECT tag_name as name, 
                   COUNT(*) as device_count,
                   SUM(quantity) as total_count,
                   COUNT(DISTINCT warehouse_name) as warehouse_count
            FROM devices
            WHERE tag_name IS NOT NULL AND tag_name != ''
        `;
        
        if (warehouseName) {
            sql += ` AND warehouse_name = '${warehouseName}'`;
        }
        
        sql += ` GROUP BY tag_name ORDER BY total_count DESC`;
        
        const tagStats = await query(sql);
        res.json(tagStats);
    } catch (err) {
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
