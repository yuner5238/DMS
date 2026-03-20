const mysql = require('mysql');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager',
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

async function migrate() {
    // 检查字段是否存在
    const columns = await query('SHOW COLUMNS FROM devices');
    const columnNames = columns.map(c => c.Field);
    
    if (!columnNames.includes('checkin_time')) {
        await query('ALTER TABLE devices ADD COLUMN checkin_time DATETIME NULL');
        console.log('✅ 添加 checkin_time 字段');
    } else {
        console.log('checkin_time 字段已存在');
    }
    
    if (!columnNames.includes('checkout_time')) {
        await query('ALTER TABLE devices ADD COLUMN checkout_time DATETIME NULL');
        console.log('✅ 添加 checkout_time 字段');
    } else {
        console.log('checkout_time 字段已存在');
    }
    
    // 为现有在库设备设置默认入库时间
    await query(`UPDATE devices SET checkin_time = NOW() WHERE checkin_time IS NULL AND (location_status = 'in_stock' OR location_status IS NULL)`);
    
    console.log('✅ 数据库迁移完成');
    pool.end();
}

migrate().catch(console.error);
