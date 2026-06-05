/**
 * 同步脚本：从 TiDB 导出数据到 D1
 * 使用方法：node data-tidb-to-d1.js
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

async function cfApi(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.cloudflare.com',
            path: `/client/v4${endpoint}`,
            method: method,
            headers: {
                'X-Auth-Email': '171519019@qq.com',
                'X-Auth-Key': CLOUDFLARE_API_KEY,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    resolve(data);
                }
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
        console.log(`[DEBUG] Cloudflare Account ID: ${cachedAccountId}`);
        return cachedAccountId;
    }
    throw new Error('无法获取 Cloudflare Account ID: ' + JSON.stringify(res.errors));
}

// D1 查询
async function d1Query(sql) {
    const accountId = await getAccountId();
    console.log(`[DEBUG] D1 Query: ${sql.substring(0, 100)}...`);
    
    const res = await cfApi(
        `/accounts/${accountId}/d1/database/${D1_DATABASE_ID}/query`,
        'POST',
        { sql }
    );
    
    if (!res.success) {
        console.error('[DEBUG] D1 API 错误:', JSON.stringify(res.errors));
        throw new Error(res.errors?.[0]?.message || 'D1 查询失败: ' + JSON.stringify(res.errors));
    }
    
    console.log(`[DEBUG] D1 返回 ${res.result.length} 个结果`);
    return res.result;
}

// ============ 辅助函数 ============

function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : '📥';
    console.log(`${prefix} [${timestamp}] ${message}`);
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

// 测试连接
pool.getConnection((err, connection) => {
    if (err) {
        console.error('[DEBUG] 连接池获取连接失败:', err.message);
        console.error('[DEBUG] 错误代码:', err.code);
        console.error('[DEBUG] 错误堆栈:', err.stack);
    } else {
        console.log('[DEBUG] 连接池测试成功，连接有效');
        connection.release();
    }
});

async function exportFromTiDB(tableName) {
    log(`开始导出 TiDB 表: ${tableName}`);
    
    try {
        const rows = await new Promise((resolve, reject) => {
            pool.getConnection((err, connection) => {
                if (err) {
                    console.error('[DEBUG] 获取连接失败:', err.message);
                    console.error('[DEBUG] 错误代码:', err.code);
                    reject(err);
                    return;
                }
                console.log(`[DEBUG] 为表 ${tableName} 获取到连接`);
                connection.query(`SELECT * FROM ${tableName}`, (err, results) => {
                    if (err) {
                        console.error('[DEBUG] 查询失败:', err.message);
                        connection.release();
                        reject(err);
                        return;
                    }
                    console.log(`[DEBUG] 表 ${tableName} 查询成功，释放连接`);
                    connection.release();
                    resolve(results);
                });
            });
        });
        
        log(`✅ TiDB 表 ${tableName} 导出成功，共 ${rows.length} 条数据`);
        
        if (rows.length > 0) {
            console.log(`[DEBUG] 第一条数据:`, JSON.stringify(rows[0]));
        }
        
        return rows;
    } catch (err) {
        console.error('[DEBUG] 完整错误堆栈:', err.stack);
        log(`❌ 导出 TiDB 表 ${tableName} 失败: ${err.message}`, 'error');
        throw err;
    }
}

function formatValue(v) {
    if (v === null) return 'NULL';
    if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
    return v;
}

// 获取 D1 表的实际列名列表
async function getD1Columns(tableName) {
    const res = await d1Query(`PRAGMA table_info(${tableName})`);
    const info = res[0]?.results || [];
    return info.map(row => row.name);
}

// 确保 D1 表包含 TiDB 数据中的所有列（自动补齐缺失列）
async function ensureD1Columns(tableName, tiDBColumns) {
    const d1Cols = await getD1Columns(tableName);
    const missing = tiDBColumns.filter(c => !d1Cols.includes(c));

    if (missing.length > 0) {
        log(`🔧 D1 表 ${tableName} 缺少 ${missing.length} 个列，正在补齐...`);
        for (const col of missing) {
            try {
                await d1Query(`ALTER TABLE ${tableName} ADD COLUMN \`${col}\` TEXT DEFAULT NULL`);
                log(`  ✅ 已添加列: ${col}`);
            } catch (e) {
                log(`  ⚠️ 添加列 ${col} 失败（可能已存在）: ${e.message}`);
            }
        }
    }

    // 返回最终可用的列名（取交集）
    const finalD1Cols = await getD1Columns(tableName);
    return tiDBColumns.filter(c => finalD1Cols.includes(c));
}

async function importToD1(tableName, rows) {
    if (rows.length === 0) {
        log(`⚠️ 表 ${tableName} 无数据，跳过导入`);
        return;
    }

    // 先备份 D1 原有数据（防止 INSERT 失败后数据丢失）
    let d1Backup = null;
    try {
        const result = await d1Query(`SELECT * FROM ${tableName}`);
        d1Backup = result[0]?.results || [];
        log(`📋 D1 表 ${tableName} 已备份 ${d1Backup.length} 条数据`);
    } catch (e) {
        log(`⚠️ D1 表 ${tableName} 备份跳过（可能不存在）: ${e.message}`);
    }

    try {
        // 确保 D1 表列完整（自动补齐 TiDB 有但 D1 缺少的列）
        const tiDBColumns = Object.keys(rows[0]);
        const validColumns = await ensureD1Columns(tableName, tiDBColumns);

        // 清空 D1 表
        await d1Query(`DELETE FROM ${tableName}`);
        log(`🗑️ 已清空 D1 表: ${tableName}`);

        // 分批插入（只包含 D1 实际存在的列，避免 "no column" 错误）
        const columns = validColumns.map(c => `\`${c}\``).join(', ');
        const BATCH_SIZE = 50;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const values = batch.map(row => {
                return `(${validColumns.map(col => formatValue(row[col])).join(', ')})`;
            }).join(', ');
            await d1Query(`INSERT INTO ${tableName} (${columns}) VALUES ${values}`);
            log(`  已导入 ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} 条...`);
        }
        log(`✅ 已导入 ${rows.length} 条数据到 D1 表: ${tableName}`);
    } catch (err) {
        log(`❌ 导入数据到 D1 表 ${tableName} 失败: ${err.message}`, 'error');

        // 尝试恢复备份数据
        if (d1Backup && d1Backup.length > 0) {
            log(`🔄 尝试恢复 D1 备份数据 (${d1Backup.length} 条)...`);
            try {
                const backupCols = Object.keys(d1Backup[0]);
                const backupValid = await ensureD1Columns(tableName, backupCols);
                const backupColumns = backupValid.map(c => `\`${c}\``).join(', ');
                const backupValues = d1Backup.map(row => {
                    return `(${backupValid.map(col => formatValue(row[col])).join(', ')})`;
                }).join(', ');
                await d1Query(`INSERT INTO ${tableName} (${backupColumns}) VALUES ${backupValues}`);
                log(`✅ D1 备份数据已恢复`);
            } catch (restoreErr) {
                log(`❌ 恢复备份也失败: ${restoreErr.message}`, 'error');
                log(`💾 备份数据仍在内存中，共 ${d1Backup.length} 条，请排查后手动恢复`, 'error');
            }
        } else {
            log(`💾 无备份数据可恢复（D1 原表为空或不存在），可重试同步`, 'error');
        }
        throw err;
    }
}

// ============ 主流程 ============

async function main() {
    console.log('='.repeat(50));
    log('🚀 开始从 TiDB 同步到 D1');
    console.log(`📍 TiDB 源: ${TIDB_CONFIG.host}:${TIDB_CONFIG.port}/${TIDB_CONFIG.database}`);
    console.log(`📍 D1 Database ID: ${D1_DATABASE_ID}`);
    console.log('='.repeat(50));
    
    let successCount = 0;
    let failCount = 0;
    
    for (const table of TABLES) {
        console.log('-'.repeat(30));
        try {
            const rows = await exportFromTiDB(table);
            if (rows.length > 0) {
                await importToD1(table, rows);
                successCount++;
            } else {
                successCount++;
            }
        } catch (err) {
            log(`❌ 同步表 ${table} 失败: ${err.message}`, 'error');
            failCount++;
        }
    }
    
    console.log('='.repeat(50));
    log(`同步完成！成功: ${successCount} 个表, 失败: ${failCount} 个表`);
    
    // 关闭连接池
    pool.end((err) => {
        if (err) console.error('[DEBUG] 关闭连接池时出错:', err);
        else console.log('[DEBUG] TiDB 连接池已关闭');
    });
    
    if (failCount > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    log(`同步出错: ${err.message}`, 'error');
    console.error('[DEBUG] 完整错误:', err);
    process.exit(1);
});
