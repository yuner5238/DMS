const mysql = require('mysql');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager',
    multipleStatements: true
});

// 修改 devices 表，将 warehouse_id 改为 warehouse_name
const sql = `
ALTER TABLE devices DROP FOREIGN KEY devices_ibfk_1;
ALTER TABLE devices CHANGE COLUMN warehouse_id warehouse_name VARCHAR(100);

-- 插入初始数据（使用仓库名称）
TRUNCATE TABLE device_tags;
TRUNCATE TABLE devices;
TRUNCATE TABLE tags;
TRUNCATE TABLE warehouses;

INSERT INTO warehouses (id, name, type, description) VALUES 
(1, '工作仓库', 'work', '办公设备存放'),
(2, '家居仓库', 'home', '家居物品存放');

INSERT INTO tags (name) VALUES 
('电脑'), ('显示器'), ('配件'), ('线缆'), ('电器'), ('家具'), ('办公设备'), ('酒类'), ('其他');

INSERT INTO devices (warehouse_name, name, category, status, quantity, remark) VALUES 
('工作仓库', 'Dell电脑主机', '电脑', '正常', 1, ''),
('工作仓库', '27寸显示器', '显示器', '正常', 2, ''),
('家居仓库', 'HDMI线', '线缆', '正常', 5, '2米规格'),
('家居仓库', '无线鼠标', '配件', '正常', 3, '');

INSERT INTO device_tags (device_id, tag_id) VALUES 
(1, 1),
(2, 2),
(3, 4),
(4, 3);
`;

pool.query(sql, (err, results) => {
    if (err) {
        console.error('修改失败:', err.message);
    } else {
        console.log('✅ 数据库结构修改成功');
    }
    pool.end();
});
