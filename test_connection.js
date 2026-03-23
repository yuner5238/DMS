const mysql = require('mysql');

const pool = mysql.createPool({
    host: 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: 'WYqCciHtZyezMP6.root',
    password: 'i6sVtriNBwHr4ZCj',
    database: 'DMS',
    ssl: {
        rejectUnauthorized: true
    }
});

console.log('🔗 正在连接 TiDB Cloud...\n');

// 测试连接
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ 连接失败:', err.message);
        process.exit(1);
    }

    console.log('✅ 连接成功！\n');

    // 查询仓库
    console.log('📦 仓库列表:');
    connection.query('SELECT * FROM warehouses', (err, results) => {
        if (err) {
            console.error('❌ 查询失败:', err.message);
        } else {
            console.log(results);
        }

        // 查询设备
        console.log('\n📱 设备列表 (前 5 条):');
        connection.query('SELECT id, name, quantity, tag_name, status FROM devices LIMIT 5', (err, results) => {
            if (err) {
                console.error('❌ 查询失败:', err.message);
            } else {
                console.log(results);
            }

            connection.release();
            pool.end();
            console.log('\n✅ 测试完成');
        });
    });
});
