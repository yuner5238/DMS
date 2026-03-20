const mysql = require('mysql');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager'
});

pool.query('DROP TABLE IF EXISTS assets', (err, result) => {
    if (err) {
        console.error('删除失败:', err.message);
    } else {
        console.log('✅ assets 表已删除');
    }
    
    // 查看最终表结构
    pool.query('SHOW TABLES', (err2, tables) => {
        console.log('当前表:', tables.map(t => t.Tables_in_device_manager));
        pool.end();
    });
});
