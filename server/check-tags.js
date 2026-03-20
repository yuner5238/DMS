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

async function checkDeviceTags() {
    // 查看 device_tags 表所有数据
    const rows = await query('SELECT * FROM device_tags ORDER BY device_id, tag_id');
    console.log('device_tags 表数据:');
    console.table(rows);
    
    // 查看 tags 表
    const tags = await query('SELECT * FROM tags');
    console.log('\ntags 表数据:');
    console.table(tags);
    
    pool.end();
}

checkDeviceTags().catch(console.error);
