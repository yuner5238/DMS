const mysql = require('mysql');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager',
    multipleStatements: true
});

// 插入初始数据
const sql = `
INSERT IGNORE INTO warehouses (id, name, type, description, tags) VALUES 
(1, '工作仓库', 'work', '办公设备存放', '["电脑", "显示器"]'),
(2, '家居仓库', 'home', '家居物品存放', '["电器", "家具"]');

INSERT IGNORE INTO assets (id, warehouse_id, name, category, status, quantity, remark, tags) VALUES 
(1, 1, 'Dell电脑主机', '电脑', '正常', 1, '', '["电脑"]'),
(2, 1, '27寸显示器', '显示器', '正常', 2, '', '["显示器"]'),
(3, 2, 'HDMI线', '线缆', '正常', 5, '2米规格', '["线缆"]'),
(4, 2, '无线鼠标', '配件', '正常', 3, '', '["配件"]');
`;

pool.query(sql, (err, results) => {
    if (err) {
        console.error('插入数据失败:', err.message);
    } else {
        console.log('✅ 初始数据导入成功');
    }
    pool.end();
});
