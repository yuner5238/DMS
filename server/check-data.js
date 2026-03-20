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

async function checkData() {
    // 查看所有设备及其标签
    const sql = `
        SELECT d.id, d.name, d.category, GROUP_CONCAT(t.name) as tags, GROUP_CONCAT(t.id) as tag_ids
        FROM devices d
        LEFT JOIN device_tags dt ON d.id = dt.device_id
        LEFT JOIN tags t ON dt.tag_id = t.id
        GROUP BY d.id
    `;
    const devices = await query(sql);
    
    console.log('所有设备及其标签:');
    console.table(devices.map(d => ({
        id: d.id,
        name: d.name,
        category: d.category,
        tags: d.tags || '(无)',
        tag_ids: d.tag_ids || '(无)'
    })));
    
    pool.end();
}

checkData().catch(console.error);
