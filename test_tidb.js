const mysql = require('mysql');

const tidbPool = mysql.createPool({
    host: 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: 'WYqCciHtZyezMP6.root',
    password: 'i6sVtriNBwHr4ZCj',
    database: 'test',
    ssl: {
        rejectUnauthorized: true
    }
});

const localPool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'DMS'
});

async function migrate() {
    try {
        // 1. 创建 DMS 数据库
        console.log('创建 DMS 数据库...');
        await query(tidbPool, 'CREATE DATABASE IF NOT EXISTS DMS');
        console.log('✅ DMS 数据库创建成功\n');

        // 2. 创建表结构
        console.log('创建表结构...');
        
        // devices 表
        await query(tidbPool, `
            CREATE TABLE IF NOT EXISTS DMS.devices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                quantity INT DEFAULT 1,
                warehouse_id INT,
                storage_location VARCHAR(255),
                location_status VARCHAR(50) DEFAULT '在库',
                destination VARCHAR(255),
                status VARCHAR(50) DEFAULT '在库',
                remark TEXT,
                category VARCHAR(100),
                tag_name VARCHAR(255),
                checkin_time DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ devices 表创建成功');

        // warehouses 表
        await query(tidbPool, `
            CREATE TABLE IF NOT EXISTS DMS.warehouses (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ warehouses 表创建成功\n');

        // 3. 复制数据
        console.log('复制数据...');
        
        // 复制 warehouses
        const warehouseCount = await query(localPool, 'SELECT COUNT(*) as cnt FROM warehouses');
        if (warehouseCount[0].cnt > 0) {
            await query(tidbPool, 'INSERT INTO DMS.warehouses SELECT * FROM DMS.warehouses WHERE 1=0');
            const warehouses = await query(localPool, 'SELECT * FROM warehouses');
            for (const w of warehouses) {
                await query(tidbPool, 'INSERT INTO DMS.warehouses (id, name, created_at) VALUES (?, ?, ?)', 
                    [w.id, w.name, w.created_at]);
            }
            console.log(`✅ 复制了 ${warehouseCount[0].cnt} 个仓库`);
        }

        // 复制 devices
        const deviceCount = await query(localPool, 'SELECT COUNT(*) as cnt FROM devices');
        if (deviceCount[0].cnt > 0) {
            const devices = await query(localPool, 'SELECT * FROM devices');
            for (const d of devices) {
                await query(tidbPool, 
                    `INSERT INTO DMS.devices (id, name, quantity, warehouse_id, storage_location, location_status, destination, status, remark, category, tag_name, checkin_time, created_at, updated_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [d.id, d.name, d.quantity, d.warehouse_id, d.storage_location, d.location_status, d.destination, d.status, d.remark, d.category, d.tag_name, d.checkin_time, d.created_at, d.updated_at]
                );
            }
            console.log(`✅ 复制了 ${deviceCount[0].cnt} 个设备`);
        }

        console.log('\n🎉 迁移完成！');

    } catch (err) {
        console.error('❌ 迁移失败:', err.message);
    } finally {
        tidbPool.end();
        localPool.end();
    }
}

function query(pool, sql, values) {
    return new Promise((resolve, reject) => {
        pool.query(sql, values, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

migrate();
