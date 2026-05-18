/**
 * 同步脚本：从 D1 导出数据到 TiDB
 */

const mysql = require('mysql2');
const https = require('https');
require('dotenv').config();

// ============ 配置 ============
const CF_EMAIL = (process.env.CF_EMAIL || '171519019@qq.com').trim();
const CLOUDFLARE_API_KEY = (process.env.CF_API_KEY || '').trim();
const D1_DATABASE_ID = 'a57bd321-c1ab-427e-a06d-41073992ab06';

if (!CLOUDFLARE_API_KEY) {
    console.error('错误: 请设置 CF_API_KEY 环境变量');
    process.exit(1);
}

const TIDB_CONFIG = {
    host: process.env.DB_TIDB_HOST,
    port: parseInt(process.env.DB_TIDB_PORT) || 4000,
    user: process.env.DB_TIDB_USER,
    password: process.env.DB_TIDB_PASSWORD,
    database: process.env.DB_TIDB_DATABASE || 'DMS',
    ssl: { rejectUnauthorized: false }
};

if (!TIDB_CONFIG.user || !TIDB_CONFIG.password || !TIDB_CONFIG.host) {
    console.error('错误: TiDB 配置不完整');
    process.exit(1);
}

const TABLES = ['warehouses', 'tags', 'devices', 'announcements'];

// ============ Cloudflare API ============

function cfApi(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.cloudflare.com',
            path: `/client/v4${endpoint}`,
            method: method,
            headers: {
                'X-Auth-Email': CF_EMAIL,
                'X-Auth-Key': CLOUDFLARE_API_KEY,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('API 响应解析失败'));
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function queryPromise(connection, sql) {
    return new Promise((resolve, reject) => {
        connection.query(sql, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

// ============ 主函数 ============

async function main() {
    console.log('='.repeat(50));
    console.log('开始同步: D1 -> TiDB');
    console.log('='.repeat(50));

    // 获取 Cloudflare Account ID
    let accountId = null;
    try {
        const res = await cfApi('/accounts');
        if (res.success && res.result.length > 0) {
            accountId = res.result[0].id;
        } else {
            throw new Error('获取 Account ID 失败');
        }
    } catch (err) {
        console.error('Cloudflare 连接失败:', err.message);
        process.exit(1);
    }

    // 创建 TiDB 连接
    let tidb;
    try {
        tidb = mysql.createConnection(TIDB_CONFIG);
        await new Promise((resolve, reject) => {
            tidb.connect(err => err ? reject(err) : resolve());
        });
        console.log('TiDB 连接成功');
    } catch (err) {
        console.error('TiDB 连接失败:', err.message);
        process.exit(1);
    }

    let successCount = 0;
    let failCount = 0;

    for (const table of TABLES) {
        console.log(`\n[${table}] 同步中...`);
        
        try {
            // 从 D1 获取数据
            const d1Res = await cfApi(
                `/accounts/${accountId}/d1/database/${D1_DATABASE_ID}/query`,
                'POST',
                { sql: `SELECT * FROM ${table}` }
            );

            if (!d1Res.success) {
                throw new Error(d1Res.errors?.[0]?.message || 'D1 查询失败');
            }

            const rows = d1Res.result[0]?.results || [];
            console.log(`  D1 导出: ${rows.length} 条`);

            if (rows.length === 0) {
                console.log(`  跳过 (无数据)`);
                successCount++;
                continue;
            }

            // 导入到 TiDB
            await queryPromise(tidb, `DELETE FROM ${table}`);
            
            const columns = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
            const values = rows.map(row => {
                return '(' + Object.values(row).map(v => {
                    if (v === null) return 'NULL';
                    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
                    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
                    return v;
                }).join(', ') + ')';
            }).join(', ');

            await queryPromise(tidb, `INSERT INTO ${table} (${columns}) VALUES ${values}`);
            console.log(`  TiDB 导入: ${rows.length} 条`);
            successCount++;

        } catch (err) {
            console.error(`  失败: ${err.message}`);
            failCount++;
        }
    }

    tidb.end();

    console.log('\n' + '='.repeat(50));
    console.log(`完成: 成功 ${successCount}, 失败 ${failCount}`);
    console.log('='.repeat(50));

    process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('执行出错:', err.message);
    process.exit(1);
});
