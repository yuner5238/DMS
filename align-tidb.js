/**
 * 对齐 TiDB 表结构，使其与 D1 保持兼容（默认值、类型一致）
 * 使用方法：node align-tidb.js
 */

const mysql = require('mysql2');
require('dotenv').config();

const TIDB_CONFIG = {
    host: (process.env.DB_TIDB_HOST || '').trim(),
    port: parseInt(process.env.DB_TIDB_PORT) || 4000,
    user: (process.env.DB_TIDB_USER || '').trim(),
    password: (process.env.DB_TIDB_PASSWORD || '').trim(),
    database: (process.env.DB_TIDB_DATABASE || 'DMS').trim(),
    ssl: { rejectUnauthorized: false },
    connectTimeout: 30000,
    multipleStatements: true,
};

function query(sql) {
    return new Promise((resolve, reject) => {
        const conn = mysql.createConnection(TIDB_CONFIG);
        conn.connect((err) => {
            if (err) { conn.end(); return reject(err); }
            conn.query(sql, (err, results) => {
                conn.end();
                if (err) reject(err);
                else resolve(results);
            });
        });
    });
}

async function main() {
    console.log('='.repeat(60));
    console.log('对齐 TiDB → D1 表结构');
    console.log('='.repeat(60));

    // ========== 1. announcements 表校验 ==========
    console.log('\n[1] 检查 announcements 表...');
    try {
        const cols = await query('SHOW COLUMNS FROM announcements');
        console.log(`   ✅ 已存在，${cols.length} 列:`);
        cols.forEach(c => console.log(`      ${c.Field}  ${c.Type}  ${c.Null === 'NO' ? 'NOT NULL' : 'NULL'}  default=${c.Default}`));
    } catch (e) {
        console.log('   ❌ 不存在，创建中...');
        await query(`CREATE TABLE IF NOT EXISTS announcements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            content TEXT NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('   ✅ 已创建');
    }

    // ========== 2. devices 表对齐 ==========
    console.log('\n[2] 对齐 devices 表...');

    const changes = [
        { col: 'device_id',          type: 'varchar(20)',  def: "''",  comment: '设备ID（6位数字码）' },
        { col: 'tag_names',          type: 'text',         def: "''",  comment: '标签' },
        { col: 'storage_location',   type: 'varchar(200)', def: "''",  comment: '存放位置' },
        { col: 'destination',        type: 'varchar(200)', def: "''",  comment: '去向' },
        { col: 'responsible_person', type: 'varchar(100)', def: "''",  comment: '负责人' },
        { col: 'remark',             type: 'text',         def: "''",  comment: '备注' },
    ];

    for (const ch of changes) {
        try {
            const sql = `ALTER TABLE devices MODIFY ${ch.col} ${ch.type} DEFAULT ${ch.def} COMMENT '${ch.comment}'`;
            await query(sql);
            console.log(`   ✅ ${ch.col}: → ${ch.type} DEFAULT ${ch.def}`);
        } catch (e) {
            console.log(`   ⚠️  ${ch.col}: ${e.message}`);
        }
    }

    // ========== 3. 验证结果 ==========
    console.log('\n[3] 验证结果:');
    const tables = ['warehouses', 'devices', 'announcements'];
    for (const t of tables) {
        try {
            const cols = await query(`SHOW COLUMNS FROM ${t}`);
            console.log(`\n   [${t}]`);
            cols.forEach(c => {
                const def = c.Default === null ? 'NULL' : `'${c.Default}'`;
                const nullable = c.Null === 'YES' ? '' : ' NOT NULL';
                console.log(`     ${c.Field.padEnd(22)} ${c.Type.padEnd(16)} ${def.padEnd(24)}${nullable.padEnd(10)} ${c.Key === 'PRI' ? 'PK' : c.Key === 'UNI' ? 'UNIQUE' : ''}`);
            });
        } catch (e) {
            console.log(`   ❌ [${t}]: ${e.message}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('对齐完成！');
    console.log('='.repeat(60));

    // 提示下一步
    console.log('\n💡 下一步:');
    console.log('   1. node sync-d1-to-tidb.js     # 把 D1 数据同步到 TiDB');
    console.log('   2. node sync-schema-tidb-to-d1.js  # (可选) 以 TiDB 为基准刷新 D1 表结构');
}

main().catch(e => {
    console.error('失败:', e.message);
    process.exit(1);
});
