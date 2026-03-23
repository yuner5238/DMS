const mysql = require('mysql');

const tidbPool = mysql.createPool({
    host: 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: 'WYqCciHtZyezMP6.root',
    password: 'i6sVtriNBwHr4ZCj',
    database: 'DMS',
    ssl: {
        rejectUnauthorized: true
    }
});

function query(pool, sql) {
    return new Promise((resolve, reject) => {
        pool.query(sql, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

async function checkData() {
    try {
        console.log('检查 TiDB DMS 数据库...\n');

        const tables = await query(tidbPool, 'SHOW TABLES');
        console.log('表列表:', tables.map(t => Object.values(t)[0]));

        const warehouseCount = await query(tidbPool, 'SELECT COUNT(*) as cnt FROM warehouses');
        console.log(`\nwarehouses 表: ${warehouseCount[0].cnt} 条数据`);
        if (warehouseCount[0].cnt > 0) {
            const warehouses = await query(tidbPool, 'SELECT * FROM warehouses');
            console.log(warehouses);
        }

        const deviceCount = await query(tidbPool, 'SELECT COUNT(*) as cnt FROM devices');
        console.log(`\ndevices 表: ${deviceCount[0].cnt} 条数据`);
        if (deviceCount[0].cnt > 0) {
            const devices = await query(tidbPool, 'SELECT * FROM devices LIMIT 3');
            console.log(devices);
        }

    } catch (err) {
        console.error('❌ 错误:', err.message);
    } finally {
        tidbPool.end();
    }
}

checkData();
