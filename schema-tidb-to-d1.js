/**
 * 以 TiDB 表结构为准，对齐 D1（补建索引和约束，确保表存在、列完整）
 * 使用方法：node schema-tidb-to-d1.js
 *
 * 与 schema-d1-to-tidb.js 互为反向：那个是以 D1 为准对齐 TiDB 列类型/默认值，
 * 这个是以 TiDB 为准对齐 D1 的索引和约束（SQLite 不支持 ALTER COLUMN，
 * 所以主要确保表存在、列完整、索引与 TiDB 一致）
 */

const https = require('https');
require('dotenv').config();

// ============ 配置 ============
const CF_EMAIL = (process.env.CF_EMAIL || '').trim();
const CLOUDFLARE_API_KEY = (process.env.CF_API_KEY || '').trim();
const D1_DATABASE_ID = 'a57bd321-c1ab-427e-a06d-41073992ab06';

if (!CLOUDFLARE_API_KEY) {
    console.error('请在 .env 中设置 CF_API_KEY');
    process.exit(1);
}

// ============ Cloudflare API ============
let cachedAccountId = null;

function cfApi(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.cloudflare.com',
            path: `/client/v4${endpoint}`,
            method: method,
            headers: {
                'X-Auth-Email': CF_EMAIL,
                'X-Auth-Key': CLOUDFLARE_API_KEY,
                'Content-Type': 'application/json',
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
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
    if (cachedAccountId) return cachedAccountId;
    const res = await cfApi('/accounts');
    if (res.success && res.result.length > 0) {
        cachedAccountId = res.result[0].id;
        console.log(`[DEBUG] Cloudflare Account ID: ${cachedAccountId}`);
        return cachedAccountId;
    }
    throw new Error('无法获取 Cloudflare Account ID: ' + JSON.stringify(res.errors));
}

async function d1Execute(sql) {
    const accountId = await getAccountId();
    console.log(`[D1] ${sql.substring(0, 120)}${sql.length > 120 ? '...' : ''}`);

    const res = await cfApi(
        `/accounts/${accountId}/d1/database/${D1_DATABASE_ID}/query`,
        'POST',
        { sql }
    );

    if (!res.success) {
        const msg = res.errors?.[0]?.message || JSON.stringify(res.errors);
        console.error(`  ❌ ${msg}`);
        return { success: false, error: msg };
    }
    console.log(`  ✅ 成功`);
    return { success: true };
}

// ============ 主流程 ============
async function main() {
    console.log('='.repeat(60));
    console.log('对齐 D1 表结构 → TiDB 兼容');
    console.log('='.repeat(60));

    // ========== 1. 确保基础表存在 ==========
    console.log('\n[1] 检查 / 创建基础表...');

    await d1Execute(`CREATE TABLE IF NOT EXISTS warehouses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'other',
        description TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await d1Execute(`CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT DEFAULT '',
        warehouse_name TEXT,
        name TEXT NOT NULL,
        tag_names TEXT DEFAULT '',
        status TEXT DEFAULT '正常',
        quantity INTEGER DEFAULT 1,
        storage_location TEXT DEFAULT '',
        location_status TEXT DEFAULT 'in_stock',
        destination TEXT DEFAULT '',
        responsible_person TEXT DEFAULT '',
        remark TEXT DEFAULT '',
        expiry_date DATE DEFAULT NULL,
        checkin_time DATETIME,
        checkout_time DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        department_path TEXT DEFAULT NULL,
        serial_number TEXT DEFAULT NULL
    )`);

    // 为已有表补加列（SQLite 不支持 IF NOT EXISTS for ADD COLUMN，需忽略重复列错误）
    await d1Execute(`ALTER TABLE devices ADD COLUMN department_path TEXT DEFAULT NULL`);
    await d1Execute(`ALTER TABLE devices ADD COLUMN serial_number TEXT DEFAULT NULL`);

    await d1Execute(`CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== 2. 创建 TiDB 中已有的索引 ==========
    console.log('\n[2] 对齐索引（与 TiDB 一致）...');

    // devices.device_id 唯一索引（TiDB: UNIQUE KEY）
    await d1Execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id)');

    // devices.warehouse_name 索引（TiDB: KEY warehouse_id）
    await d1Execute('CREATE INDEX IF NOT EXISTS idx_devices_warehouse_name ON devices(warehouse_name)');

    // devices.tag_names 索引（TiDB: KEY tag_names(191)，SQLite 用全文或普通索引）
    await d1Execute('CREATE INDEX IF NOT EXISTS idx_devices_tag_names ON devices(tag_names)');

    // ========== 3. 验证结果 ==========
    console.log('\n[3] 验证结果:');
    const tables = ['warehouses', 'devices', 'announcements'];

    for (const table of tables) {
        try {
            const accountId = await getAccountId();
            const res = await cfApi(
                `/accounts/${accountId}/d1/database/${D1_DATABASE_ID}/query`,
                'POST',
                { sql: `SELECT COUNT(*) AS cnt FROM ${table}` }
            );
            const cnt = res.result?.[0]?.results?.[0]?.cnt ?? '?';
            console.log(`   [${table}] ✅ 存在，${cnt} 条记录`);
        } catch (e) {
            console.log(`   [${table}] ❌ ${e.message}`);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('对齐完成！');
    console.log('='.repeat(60));

    console.log('\n💡 下一步:');
    console.log('   1. node data-tidb-to-d1.js     # 把 TiDB 数据同步到 D1');
}

main().catch((e) => {
    console.error('失败:', e.message);
    process.exit(1);
});
