const mysql = require('mysql');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager',
    multipleStatements: true
});

// 添加出库状态和去向字段
const sql = `
ALTER TABLE devices ADD COLUMN location_status VARCHAR(20) DEFAULT 'in_stock' AFTER quantity;
ALTER TABLE devices ADD COLUMN destination VARCHAR(200) DEFAULT NULL AFTER location_status;

-- 将现有设备设置为在库状态
UPDATE devices SET location_status = 'in_stock';

-- 插入一些测试用的已出库设备
INSERT INTO devices (warehouse_name, name, category, status, quantity, location_status, destination, remark) VALUES 
('工作仓库', '借用显示器', '显示器', '正常', 1, 'checked_out', '同事张三借用', '已出库测试'),
('工作仓库', '移动硬盘', '配件', '正常', 1, 'checked_out', '项目A使用中', '');
`;

pool.query(sql, (err, results) => {
    if (err) {
        console.error('修改失败:', err.message);
    } else {
        console.log('✅ 数据库添加出库状态字段成功');
    }
    pool.end();
});
