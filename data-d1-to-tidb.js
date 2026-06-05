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
    host: (process.env.DB_TIDB_HOST || '').trim(),
    port: parseInt(process.env.DB_TIDB_PORT) || 4000,
    user: (process.env.DB_TIDB_USER || '').trim(),
    password: (process.env.DB_TIDB_PASSWORD || '').trim(),
    database: (process.env.DB_TIDB_DATABASE || 'DMS').trim(),
    ssl: { rejectUnauthorized: false },
    connectTimeout: 30000,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
};

if (!TIDB_CONFIG.user || !TIDB_CONFIG.password || !TIDB_CONFIG.host) {
    console.error('错误: TiDB 配置不完整');
    console.error('  DB_TIDB_HOST:', TIDB_CONFIG.host ? '已设置' : '未设置');
    console.error('  DB_TIDB_USER:', TIDB_CONFIG.user ? '已设置' : '未设置');
    console.error('  DB_TIDB_PASSWORD:', TIDB_CONFIG.password ? '已设置' : '未设置');
    process.exit(1);
}

console.log('[DEBUG] TiDB 配置:');
console.log('  host:', TIDB_CONFIG.host);
console.log('  port:', TIDB_CONFIG.port);
console.log('  user:', TIDB_CONFIG.user);
console.log('  database:', TIDB_CONFIG.database);

const TABLES = ['warehouses', 'devices', 'announcements'];

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

// 创建连接池
const pool = mysql.createPool(TIDB_CONFIG);
console.log('[DEBUG] TiDB 连接池已创建');

// 测试连接池
pool.getConnection((err, connection) => {
    if (err) {
        console.error('[DEBUG] 连接池获取连接失败:', err.message);
        console.error('[DEBUG] 错误代码:', err.code);
    } else {
        console.log('[DEBUG] 连接池测试成功');
        connection.release();
    }
});

function queryPool(sql) {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                reject(err);
                return;
            }
            connection.query(sql, (err, results) => {
                connection.release();
                if (err) reject(err);
                else resolve(results);
            });
        });
    });
}

// 在事务中执行：先 DELETE 旧数据，再逐行 INSERT（参数化查询，自动转义特殊字符）
// 如果 INSERT 失败则自动回滚，不会丢失 TiDB 原有数据
function syncTableInTransaction(table, columnsArr, rows) {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) return reject(err);

            connection.beginTransaction(err => {
                if (err) {
                    connection.release();
                    return reject(err);
                }

                // 1. 清空旧数据
                connection.query(`DELETE FROM ${table}`, (err) => {
                    if (err) {
                        return connection.rollback(() => {
                            connection.release();
                            reject(err);
                        });
                    }

                    // 2. 逐行 INSERT（参数化查询，自动处理单引号、换行符等）
                    let completed = 0;
                    let hasError = false;

                    for (const row of rows) {
                        const placeholders = columnsArr.map(() => '?').join(', ');
                        const values = columnsArr.map(col => row[col]);
                        const sql = `INSERT INTO ${table} (\`${columnsArr.join('`, `')}\`) VALUES (${placeholders})`;

                        connection.query(sql, values, (err) => {
                            if (err && !hasError) {
                                hasError = true;
                                return connection.rollback(() => {
                                    connection.release();
                                    reject(err);
                                });
                            }
                            completed++;
                            if (completed === rows.length && !hasError) {
                                connection.commit(err => {
                                    connection.release();
                                    if (err) return reject(err);
                                    resolve();
                                });
                            }
                        });
                    }
                });
            });
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

    console.log('[DEBUG] Cloudflare Account ID:', accountId);

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

            // 在事务中同步到 TiDB（DELETE + INSERT，失败自动回滚）
            const columnsArr = Object.keys(rows[0]);
            await syncTableInTransaction(table, columnsArr, rows);
            console.log(`  TiDB 导入: ${rows.length} 条 (事务提交成功)`);
            successCount++;

        } catch (err) {
            console.error(`  失败: ${err.message}`);
            console.error(`  错误代码: ${err.code || '无'}`);
            console.error(`  SQL状态: ${err.sqlState || '无'}`);
            if (err.sql) console.error(`  出错的SQL: ${err.sql.substring(0, 200)}...`);
            failCount++;
        }
    }

    // 关闭连接池
    pool.end((err) => {
        if (err) console.error('[DEBUG] 关闭连接池时出错:', err);
        else console.log('[DEBUG] TiDB 连接池已关闭');
    });

    console.log('\n' + '='.repeat(50));
    console.log(`完成: 成功 ${successCount}, 失败 ${failCount}`);
    console.log('='.repeat(50));

    process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('执行出错:', err.message);
    process.exit(1);
});
