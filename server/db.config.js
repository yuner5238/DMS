// 数据库配置文件
// 切换方式：修改 .env 中的 DB_ACTIVE 为 'local' 或 'TiDB'
// 敏感信息支持加密存储

const { decrypt, loadEnv } = require('./encryption');
loadEnv();

const active = process.env.DB_ACTIVE;

// 读取配置（支持加密值）
const getEnv = (key, fallback = '') => {
    const value = process.env[key] || fallback;
    return value.includes(':') ? decrypt(value) : value;
};

// 根据 DB_ACTIVE 读取对应的配置
const getConfig = (type) => ({
    host: getEnv(`DB_${type}_HOST`, type === 'local' ? '127.0.0.1' : ''),
    port: parseInt(getEnv(`DB_${type}_PORT`, type === 'local' ? '3306' : '4000')),
    user: getEnv(`DB_${type}_USER`, ''),
    password: getEnv(`DB_${type}_PASSWORD`, ''),
    database: getEnv(`DB_${type}_DATABASE`, 'DMS'),
    ...(type === 'TiDB' ? { ssl: { rejectUnauthorized: false } } : {})
});

console.log('[DEBUG] DB_ACTIVE:', active);
console.log('[DEBUG] DB_HOST:', getEnv(`DB_${active}_HOST`, ''));
console.log('[DEBUG] DB Config:', getConfig(active));

module.exports = { active, dbConfig: getConfig(active) };
