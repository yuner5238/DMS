const mysql = require('mysql');
const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager'
});

pool.query(`
    SELECT tag_name as name, 
           COUNT(*) as device_count,
           SUM(quantity) as total_count,
           COUNT(DISTINCT warehouse_name) as warehouse_count
    FROM devices
    WHERE tag_name IS NOT NULL AND tag_name != ''
    GROUP BY tag_name
    ORDER BY total_count DESC
`, (err, results) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log(JSON.stringify(results, null, 2));
    }
    pool.end();
});
