/**
 * 同步脚本：从 D1 导出数据到 TiDB
 * 使用方法：node sync-d1-to-tidb.js
 */

const mysql = require('mysql2');
const https = require('https');
require('dotenv').config();

// ============ 配置 ============
const CLOUDFLARE_API_KEY = process.env.CF_API_KEY;
const D1_DATABASE_ID = 'a57bd321-c1ab-427e-a06d-41073992ab06';

if (!CLOUDFLARE_API_KEY) {
    console.error('请在 .env 中设置 CF_API_KEY');
    process.exit(1);
}

const TIDB_CONFIG = {
    host: process.env.DB_TIDB_HOST || 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: parseInt(process.env.DB_TIDB_PORT) || 4000,
    user: process.env.DB_TIDB_USER,
    password: process.env.DB_TIDB_PASSWORD,
    database: process.env.DB_TIDB_DATABASE || 'DMS',
    ssl: { rejectUnauthorized: false }
};

if (!TIDB_CONFIG.user || !TIDB_CONFIG.password) {
    console.error('请在 .env 中设置 TiDB 配置 (DB_TIDB_USER, DB_TIDB_PASSWORD)');
    process.exit(1);
}

const TABLES = ['warehouses', 'tags', 'devices', 'announcements'];

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
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : '📤';
    console.log(`${prefix} [${timestamp}] ${message}`);
}

async function exportFromD1(tableName) {
    log(`开始导出 D1 表: ${tableName}`);
    try {
        const result = await d1Query(`SELECT * FROM ${tableName}`);
        const rows = result[0]?.results || [];
        log(`✅ D1 表 ${tableName} 导出成功，共 ${rows.length} 条数据`);
        
        if (rows.length > 0) {
            console.log(`[DEBUG] 第一条数据:`, JSON.stringify(rows[0]));
        }
        
        return rows;
    } catch (err) {
        log(`❌ 导出 D1 表 ${tableName} 失败: ${err.message}`, 'error');
        throw err; // 重新抛出错误，不再静默忽略
    }
}

function formatValue(v) {
    if (v === null) return 'NULL';
    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
    return v;
}

function queryPromise(connection, sql) {
    return new Promise((resolve, reject) => {
        connection.query(sql, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
}

async function importToTiDB(tableName, rows) {
    if (rows.length === 0) {
        log(`⚠️ 表 ${tableName} 无数据，跳过导入`);
        return;
    }

    const connection = mysql.createConnection(TIDB_CONFIG);
    
    try {
        // 清空目标表
        await queryPromise(connection, `DELETE FROM ${tableName}`);
        log(`🗑️ 已清空 TiDB 表: ${tableName}`);
        
        // 批量插入
        const columns = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
        const values = rows.map(row => {
            return `(${Object.values(row).map(formatValue).join(', ')})`;
        }).join(', ');
        
        await queryPromise(connection, `INSERT INTO ${tableName} (${columns}) VALUES ${values}`);
        log(`✅ 已导入 ${rows.length} 条数据到 TiDB 表: ${tableName}`);
    } catch (err) {
        log(`❌ 导入数据到 TiDB 表 ${tableName} 失败: ${err.message}`, 'error');
        throw err;
    } finally {
        connection.end();
    }
}

// ============ 主流程 ============

async function main() {
    console.log('='.repeat(50));
    log('🚀 开始从 D1 同步到 TiDB');
    console.log(`📍 TiDB 目标: ${TIDB_CONFIG.host}:${TIDB_CONFIG.port}/${TIDB_CONFIG.database}`);
    console.log(`📍 D1 Database ID: ${D1_DATABASE_ID}`);
    console.log('='.repeat(50));
    
    let successCount = 0;
    let failCount = 0;
    
    for (const table of TABLES) {
        console.log('-'.repeat(30));
        try {
            const rows = await exportFromD1(table);
            if (rows.length > 0) {
                await importToTiDB(table, rows);
                successCount++;
            } else {
                successCount++; // 无数据的表也算成功
            }
        } catch (err) {
            log(`❌ 同步表 ${table} 失败: ${err.message}`, 'error');
            failCount++;
        }
    }
    
    console.log('='.repeat(50));
    log(`同步完成！成功: ${successCount} 个表, 失败: ${failCount} 个表`);
    
    if (failCount > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    log(`同步出错: ${err.message}`, 'error');
    console.error('[DEBUG] 完整错误:', err);
    process.exit(1);
});
