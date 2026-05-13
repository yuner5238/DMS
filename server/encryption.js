// 加密工具模块
// 用于加密/解密敏感配置信息

const crypto = require('crypto');

// 加载 .env 文件
function loadEnv() {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match && !line.trim().startsWith('#')) {
                process.env[match[1].trim()] = match[2].trim();
            }
        });
    }
}

// 加密密钥（生产环境请在 .env 中设置 ENCRYPTION_KEY）
const getKey = () => {
    if (!process.env.ENCRYPTION_KEY) {
        loadEnv();
    }
    
    const key = process.env.ENCRYPTION_KEY || 'dms-default-key-32chars!!';
    return Buffer.from(key.slice(0, 32).padEnd(32, '!'), 'utf8');
};
const IV_LENGTH = 16;
const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
    if (!text || text === '') return text;
    
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('加密失败:', error.message);
        return text;
    }
}

function decrypt(encryptedText) {
    if (!encryptedText || !encryptedText.includes(':')) return encryptedText;
    
    try {
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        
        const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('解密失败:', error.message);
        return encryptedText;
    }
}

module.exports = { encrypt, decrypt, loadEnv };
