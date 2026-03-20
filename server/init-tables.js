const mysql = require('mysql');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager',
    multipleStatements: true
});

const sql = `
DROP TABLE IF EXISTS device_tags;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS warehouses;

CREATE TABLE warehouses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) DEFAULT 'other',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    warehouse_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(50),
    status VARCHAR(20) DEFAULT '正常',
    quantity INT DEFAULT 1,
    remark TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
);

CREATE TABLE device_tags (
    device_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (device_id, tag_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
`;

pool.query(sql, (err, results) => {
    if (err) {
        console.error('创建表失败:', err.message);
    } else {
        console.log('✅ 新表结构创建成功');
        
        // 插入初始数据
        const initData = `
            INSERT INTO warehouses (id, name, type, description) VALUES 
            (1, '工作仓库', 'work', '办公设备存放'),
            (2, '家居仓库', 'home', '家居物品存放');

            INSERT INTO tags (name) VALUES 
            ('电脑'), ('显示器'), ('配件'), ('线缆'), ('电器'), ('家具'), ('办公设备'), ('酒类'), ('其他');

            INSERT INTO devices (warehouse_id, name, category, status, quantity, remark) VALUES 
            (1, 'Dell电脑主机', '电脑', '正常', 1, ''),
            (1, '27寸显示器', '显示器', '正常', 2, ''),
            (2, 'HDMI线', '线缆', '正常', 5, '2米规格'),
            (2, '无线鼠标', '配件', '正常', 3, '');

            INSERT INTO device_tags (device_id, tag_id) VALUES 
            (1, 1),   -- Dell电脑主机 -> 电脑
            (2, 2),   -- 27寸显示器 -> 显示器
            (3, 4),   -- HDMI线 -> 线缆
            (4, 3);   -- 无线鼠标 -> 配件
        `;
        
        pool.query(initData, (err2, results2) => {
            if (err2) {
                console.error('插入初始数据失败:', err2.message);
            } else {
                console.log('✅ 初始数据导入成功');
            }
            pool.end();
        });
    }
});
