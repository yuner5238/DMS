const mysql = require('mysql');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager'
});

pool.query('SHOW TABLES', (err, tables) => {
    if (err) {
        console.error('查询失败:', err.message);
    } else {
        console.log('当前表:', JSON.stringify(tables, null, 2));
    }
    pool.end();
});
