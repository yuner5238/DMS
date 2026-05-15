/**
 * 同步脚本：从 D1 导出数据到 TiDB
 * 使用方法：node sync-d1-to-tidb.js
 */

const mysql = require('mysql2/promise');
const https = require('https');

// ============ 配置 ============
const CLOUDFLARE_EMAIL = '171519019@qq.com';  // 你的 Cloudflare 邮箱
const CLOUDFLARE_API_KEY = 'cfk_NIJD65CqxZX4QLjYngVu0stkXOiS5SGdL2RMcgm106398dca';
const D1_DATABASE_ID = 'a57bd321-c1ab-427e-a06d-41073992ab06';

const TIDB_CONFIG = {
    host: 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: 'WYqCciHtZyezMP6.root',
    password: 'i6sVtriNBwHr4ZCj',
    database: 'DMS',
    ssl: { rejectUnauthorized: false }
};

const TABLES = ['warehouses', 'tags', 'devices', 'announcements'];

// ============ Cloudflare API ============

async function cfApi(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.cloudflare.com',
            path: `/client/v4${endpoint}`,
            method: method,
            headers: {
                'X-Auth-Email': CLOUDFLARE_EMAIL,
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

async function getAccountId() {
    const res = await cfApi('/accounts');
    if (res.success && res.result.length > 0) {
        return res.result[0].id;
    }
    throw new Error('无法获取 Cloudflare Account ID: ' + JSON.stringify(res.errors));
}

// D1 查询
async function d1Query(sql) {
    const accountId = await getAccountId();
    const res = await cfApi(
        `/accounts/${accountId}/d1/database/${D1_DATABASE_ID}/query`,
        'POST',
        { sql }
    );
    if (!res.success) {
        throw new Error(res.errors?.[0]?.message || 'D1 查询失败');
    }
    return res.result;
}

// ============ 辅助函数 ============

function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : '📤';
    console.log(`${prefix} [${timestamp}] ${message}`);
}

async function exportFromD1(tableName) {
    log(`从 D1 导出表: ${tableName}`);
    try {
        const result = await d1Query(`SELECT * FROM ${tableName}`);
        const rows = result[0]?.results || [];
        log(`从 D1 导出 ${rows.length} 条数据`);
        return rows;
    } catch (err) {
        log(`导出 ${tableName} 失败: ${err.message}`, 'error');
        return [];
    }
}

function formatValue(v) {
    if (v === null) return 'NULL';
    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
    return v;
}

async function importToTiDB(tableName, rows) {
    if (rows.length === 0) {
        log(`表 ${tableName} 无数据，跳过`);
        return;
    }

    const connection = await mysql.createConnection(TIDB_CONFIG);
    
    try {
        // 清空目标表
        await connection.query(`DELETE FROM ${tableName}`);
        log(`已清空 TiDB 表: ${tableName}`);
        
        // 批量插入
        const columns = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
        const values = rows.map(row => {
            return `(${Object.values(row).map(formatValue).join(', ')})`;
        }).join(', ');
        
        await connection.query(`INSERT INTO ${tableName} (${columns}) VALUES ${values}`);
        log(`已导入 ${rows.length} 条数据到 TiDB 表: ${tableName}`, 'success');
    } finally {
        await connection.end();
    }
}

// ============ 主流程 ============

async function main() {
    log('开始从 D1 同步到 TiDB');
    log(`TiDB 目标: ${TIDB_CONFIG.host}:${TIDB_CONFIG.port}/${TIDB_CONFIG.database}`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const table of TABLES) {
        try {
            const rows = await exportFromD1(table);
            if (rows.length > 0) {
                await importToTiDB(table, rows);
                successCount++;
            }
        } catch (err) {
            log(`同步表 ${table} 失败: ${err.message}`, 'error');
            failCount++;
        }
    }
    
    log('='.repeat(50));
    log(`同步完成！成功: ${successCount} 个表, 失败: ${failCount} 个表`);
}

main().catch(err => {
    log(`同步出错: ${err.message}`, 'error');
    process.exit(1);
});
