const mysql = require('mysql');
const conn = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'device_manager'
});

conn.query('SELECT * FROM tags', (err, results) => {
    if (err) console.log(err);
    else console.log('Tags:', JSON.stringify(results, null, 2));
    conn.end();
});
