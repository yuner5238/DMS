const mysql = require('mysql');
const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager'
});

pool.query('SELECT id, name, tag_name, quantity FROM devices LIMIT 10', (err, results) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log(JSON.stringify(results, null, 2));
    }
    pool.end();
});
