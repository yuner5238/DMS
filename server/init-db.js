const mysql = require('mysql');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    connectionLimit: 10
});

const query = (sql, values = []) => {
    return new Promise((resolve, reject) => {
        pool.query(sql, values, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

async function init() {
    try {
        // 创建数据库
        await query('CREATE DATABASE IF NOT EXISTS DMS CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        console.log('✅ 数据库 DMS 创建成功');

        // 切换到 DMS 数据库
        await query('USE DMS');

        // 创建设备表
        await query(`
            CREATE TABLE IF NOT EXISTS devices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                sn VARCHAR(100) UNIQUE,
                model VARCHAR(100),
                brand VARCHAR(50),
                category VARCHAR(50),
                purchase_date DATE,
                warranty_end DATE,
                status ENUM('正常', '维修中', '已报废') DEFAULT '正常',
                location_status ENUM('in_stock', 'in_use', 'maintenance', 'retired') DEFAULT 'in_stock',
                warehouse_id INT,
                warehouse_name VARCHAR(100),
                location VARCHAR(100),
                holder VARCHAR(100),
                department VARCHAR(100),
                remarks TEXT,
                checkin_time DATETIME,
                checkout_time DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✅ devices 表创建成功');

        // 创建仓库表
        await query(`
            CREATE TABLE IF NOT EXISTS warehouses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                location VARCHAR(100),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✅ warehouses 表创建成功');

        // 创建标签表
        await query(`
            CREATE TABLE IF NOT EXISTS tags (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL UNIQUE,
                color VARCHAR(20) DEFAULT '#89b4fa',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✅ tags 表创建成功');

        // 创建设备标签关联表
        await query(`
            CREATE TABLE IF NOT EXISTS device_tags (
                device_id INT NOT NULL,
                tag_id INT NOT NULL,
                PRIMARY KEY (device_id, tag_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✅ device_tags 表创建成功');

        // 创建公告表
        await query(`
            CREATE TABLE IF NOT EXISTS announcements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        console.log('✅ announcements 表创建成功');

        console.log('\n✅ 数据库初始化完成！');
        pool.end();
    } catch (err) {
        console.error('❌ 错误:', err.message);
        pool.end();
    }
}

init();
