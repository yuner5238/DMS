/**
 * 一次性迁移：把 D1 中按 UTC 写入的时间 +8h，统一为北京时间（时间方案B）
 *
 * ⚠️ 只能跑一次！重复运行会把时间再加 8 小时。
 * ⚠️ 正确顺序：低峰期先跑本脚本 → 立即部署新的 worker（方案B代码）
 *             新代码部署之后再跑本脚本，会把新写入的数据错误地再 +8h
 *
 * 范围：devices / warehouses 的 created_at、updated_at、checkin_time、checkout_time
 *      （announcements 历来就是北京时间写入，不需要迁移）
 *
 * 运行方式：CONFIRM=YES node migrate-beijing-time.js
 */

const https = require('https');
require('dotenv').config();

const CLOUDFLARE_API_KEY = (process.env.CF_API_KEY || '').trim();
const D1_DATABASE_ID = 'a57bd321-c1ab-427e-a06d-41073992ab06';

if (!CLOUDFLARE_API_KEY) {
    console.error('请在 .env 中设置 CF_API_KEY');
    process.exit(1);
}

if (process.env.CONFIRM !== 'YES') {
    console.error('⚠️  这是【不可重复执行】的一次性迁移（所有时间 +8h）。');
    console.error('    确认要执行请运行：CONFIRM=YES node migrate-beijing-time.js');
    process.exit(1);
}

// ============ Cloudflare API（与 data-tidb-to-d1.js 相同的认证方式） ============

async function cfApi(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.cloudflare.com',
            path: `/client/v4${endpoint}`,
            method: method,
            headers: {
                'X-Auth-Email': process.env.CF_EMAIL || '171519019@qq.com',
                'X-Auth-Key': CLOUDFLARE_API_KEY,
                'Content-Type': 'application/json'
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
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
        throw new Error('D1 API 错误: ' + JSON.stringify(res.errors));
    }
    return res.result?.[0] || {};
}

// ============ 迁移 ============

const SHIFTS = [
    ['devices', 'created_at'],
    ['devices', 'updated_at'],
    ['devices', 'checkin_time'],
    ['devices', 'checkout_time'],
    ['warehouses', 'created_at'],
    ['warehouses', 'updated_at'],
];

async function main() {
    console.log('开始迁移：D1 时间 UTC → 北京时间（+8h），每个字段只执行一次');
    for (const [table, col] of SHIFTS) {
        // datetime() 同时兼容 '2026-09-03T02:00:00.000Z' 与 '2026-09-03 02:00:00' 两种历史格式，
        // 输出统一为 'YYYY-MM-DD HH:MM:SS'
        const sql = `UPDATE ${table} SET ${col} = datetime(${col}, '+8 hours') WHERE ${col} IS NOT NULL AND ${col} != ''`;
        const result = await d1Query(sql);
        const changes = result.meta?.changes ?? '?';
        console.log(`✅ ${table}.${col} 已 +8h（更新 ${changes} 行）`);
    }
    console.log('');
    console.log('🎉 迁移完成。请立即部署新的 worker（方案B代码）。此后不要再运行本脚本。');
}

main().catch(err => {
    console.error('迁移失败:', err.message);
    process.exit(1);
});