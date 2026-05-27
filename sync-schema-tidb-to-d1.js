/**
 * 架构同步脚本：以 TiDB 为基准，重建 D1 表结构 + 同步数据
 * 使用方法：node sync-schema-tidb-to-d1.js
 */

const mysql = require('mysql2');
const https = require('https');
require('dotenv').config();

// ============ 配置 ============
const CLOUDFLARE_API_KEY = (process.env.CF_API_KEY || '').trim();
const D1_DATABASE_ID = 'a57bd321-c1ab-427e-a06d-41073992ab06';

if (!CLOUDFLARE_API_KEY) {
    console.error('请在 .env 中设置 CF_API_KEY');
    process.exit(1);
}

const TIDB_CONFIG = {
    host: (process.env.DB_TIDB_HOST || '').trim(),
    port: parseInt(process.env.DB_TIDB_PORT) || 4000,
    user: (process.env.DB_TIDB_USER || '').trim(),
    password: (process.env.DB_TIDB_PASSWORD || '').trim(),
    database: (process.env.DB_TIDB_DATABASE || 'DMS').trim(),
    ssl: { rejectUnauthorized: false },
};

// ============ Cloudflare API ============

async function cfApi(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.cloudflare.com',
            path: `/client/v4${endpoint}`,
            method,
            headers: {
                'X-Auth-Email': '171519019@qq.com',
                'X-Auth-Key': CLOUDFLARE_API_KEY,
                'Content-Type': 'application/json',
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(data); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

let cachedAccountId = null;
async function getAccountId() {
    if (cachedAccountId) return cachedAccountId;
    const res = await cfApi('/accounts');
    if (res.success && res.result.length > 0) {
        cachedAccountId = res.result[0].id;
        return cachedAccountId;
    }
    throw new Error('无法获取 Cloudflare Account ID: ' + JSON.stringify(res.errors));
}

async function d1Query(sql) {
    const accountId = await getAccountId();
    const res = await cfApi(
        `/accounts/${accountId}/d1/database/${D1_DATABASE_ID}/query`,
        'POST',
        { sql }
    );
    if (!res.success) {
        throw new Error(res.errors?.[0]?.message || 'D1 查询失败: ' + JSON.stringify(res.errors));
    }
    return res.result;
}

// ============ TiDB 连接 ============

function queryTiDB(sql) {
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

// ============ 类型映射 MySQL → SQLite ============

function mysqlTypeToSqlite(type) {
    const t = type.toUpperCase();
    if (t.includes('INT')) return 'INTEGER';
    if (t.includes('CHAR') || t.includes('TEXT') || t.includes('ENUM')) return 'TEXT';
    if (t.includes('DATE') && !t.includes('TIME')) return 'DATE';
    if (t.includes('TIME')) return 'DATETIME';
    if (t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('DECIMAL')) return 'REAL';
    if (t.includes('BLOB') || t.includes('BINARY')) return 'BLOB';
    return 'TEXT'; // fallback
}

// ============ 主流程 ============

async function main() {
    console.log('='.repeat(60));
    console.log('以 TiDB 为基准，同步表结构 → D1');
    console.log('='.repeat(60));

    const tables = ['warehouses', 'devices', 'announcements'];

    for (const table of tables) {
        console.log(`\n${'─'.repeat(40)}`);
        console.log(`[${table}] 开始同步...`);

        try {
            // 1. 获取 TiDB 表结构
            console.log(`  1. 读取 TiDB 列信息...`);
            const columns = await queryTiDB(`SHOW COLUMNS FROM ${table}`);
            console.log(`     发现 ${columns.length} 个列`);

            // 2. 生成 D1 SQLite 建表语句
            let createSQL = `CREATE TABLE IF NOT EXISTS ${table} (\n`;
            const colDefs = columns.map((col) => {
                const sqliteType = mysqlTypeToSqlite(col.Type);
                let def = `  ${col.Field} ${sqliteType}`;
                if (col.Null === 'NO') def += ' NOT NULL';
                if (col.Default !== null && col.Default !== 'CURRENT_TIMESTAMP' && col.Default !== 'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') {
                    const dv = col.Default;
                    if (typeof dv === 'string') def += ` DEFAULT '${dv.replace(/'/g, "''")}'`;
                    else def += ` DEFAULT ${dv}`;
                } else if (col.Default !== null && col.Default.includes('CURRENT_TIMESTAMP')) {
                    def += ' DEFAULT CURRENT_TIMESTAMP';
                }
                // 主键
                if (col.Key === 'PRI') {
                    def += ' PRIMARY KEY AUTOINCREMENT';
                }
                return def;
            });
            createSQL += colDefs.join(',\n');
            createSQL += '\n);';

            console.log(`  2. 生成 D1 SQL:`);
            console.log(createSQL);

            // 3. 备份 D1 现有数据（如果表存在）
            let existingRows = [];
            try {
                const checkResult = await d1Query(`SELECT * FROM ${table} LIMIT 1`);
                if (checkResult && checkResult.length > 0) {
                    const allData = await d1Query(`SELECT * FROM ${table}`);
                    existingRows = allData[0]?.results || [];
                    console.log(`  3. D1 表已存在，现有 ${existingRows.length} 条数据，先备份到内存`);
                } else {
                    console.log(`  3. D1 表不存在或为空`);
                }
            } catch (e) {
                console.log(`  3. D1 表不存在（将新建）`);
            }

            // 4. 删除旧表，创建新表
            console.log(`  4. 删除旧表...`);
            await d1Query(`DROP TABLE IF EXISTS ${table}`);

            console.log(`  5. 创建新表...`);
            await d1Query(createSQL);

            // 5. 从 TiDB 拉取数据并写入 D1
            console.log(`  6. 从 TiDB 拉取数据...`);
            const tidbRows = await queryTiDB(`SELECT * FROM ${table}`);

            if (tidbRows.length > 0) {
                console.log(`     获取到 ${tidbRows.length} 条数据`);

                // 过滤掉 TiDB 特有的列（如 auto_increment 的 id 等，D1 会自动生成）
                const columns2 = Object.keys(tidbRows[0]).map(c => `\`${c}\``).join(', ');

                function formatValue(v) {
                    if (v === null) return 'NULL';
                    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
                    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
                    return v;
                }

                const values = tidbRows.map(row =>
                    `(${Object.values(row).map(formatValue).join(', ')})`
                ).join(', ');

                const insertSQL = `INSERT INTO ${table} (${columns2}) VALUES ${values}`;
                await d1Query(insertSQL);
                console.log(`     已写入 D1`);
            } else {
                console.log(`     TiDB 该表无数据，跳过数据同步`);
            }

            console.log(`  ✅ [${table}] 完成`);

        } catch (err) {
            console.error(`  ❌ [${table}] 失败: ${err.message}`);
            console.error(`  堆栈: ${err.stack}`);
            process.exit(1);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ 所有表结构同步完成！');
    console.log('='.repeat(60));
}

main().catch((err) => {
    console.error('执行出错:', err.message);
    console.error(err.stack);
    process.exit(1);
});
