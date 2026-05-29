// S3 对象存储配置文件
// 切换方式：修改 .env 中的 S3_ACTIVE = 'hi168' 或 'cstcloud'
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const active = process.env.S3_ACTIVE || 'cstcloud';

const getConfig = (type) => ({
    endpoint: process.env[`S3_${type}_ENDPOINT`] || '',
    region: process.env[`S3_${type}_REGION`] || 'us-east-1',
    bucket: process.env[`S3_${type}_BUCKET`] || '',
    publicUrl: process.env[`S3_${type}_PUBLIC_URL`] || '',
    accessKey: process.env[`S3_${type}_ACCESS_KEY`] || '',
    secretKey: process.env[`S3_${type}_SECRET_KEY`] || '',
    basePrefix: 'DMS storage/',  // bucket 内根目录前缀，隔离不同项目
});

const s3Config = getConfig(active);

console.log(`[S3 CONFIG] ACTIVE: ${active}`);
console.log(`[S3 CONFIG] Endpoint: ${s3Config.endpoint}`);
console.log(`[S3 CONFIG] Bucket: ${s3Config.bucket}`);

module.exports = { active, s3Config };
