// S3 对象存储配置文件
// 切换方式：修改 .env 中的 S3_ACTIVE = 'hi168' 或 'cstcloud'
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const active = process.env.S3_ACTIVE || 'cstcloud';

// 平台 → .env 键前缀映射（cstcloud 已统一为 CSTCLOUD_S3_*；hi168 保留 S3_hi168_*）
const PREFIX = { cstcloud: "CSTCLOUD_S3", hi168: "S3_hi168" };

const getConfig = (type) => {
    const p = PREFIX[type] || `S3_${type}`;
    return {
        endpoint: process.env[`${p}_ENDPOINT`] || '',
        region: process.env[`${p}_REGION`] || 'us-east-1',
        bucket: process.env[`${p}_BUCKET`] || '',
        publicUrl: process.env[`${p}_PUBLIC_URL`] || '',
        accessKey: process.env[`${p}_ACCESS_KEY`] || '',
        secretKey: process.env[`${p}_SECRET_KEY`] || '',
        basePrefix: 'DMS storage/',  // bucket 内根目录前缀，隔离不同项目
    };
};

const s3Config = getConfig(active);

console.log(`[S3 CONFIG] ACTIVE: ${active}`);
console.log(`[S3 CONFIG] Endpoint: ${s3Config.endpoint}`);
console.log(`[S3 CONFIG] Bucket: ${s3Config.bucket}`);

module.exports = { active, s3Config };
