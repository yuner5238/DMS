const mysql = require('mysql');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { active, dbConfig } = require('./db.config');

const pool = mysql.createPool({
    ...dbConfig,
    connectionLimit: 5
});

const query = (sql, values = []) => {
    return new Promise((resolve, reject) => {
        pool.query(sql, values, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

async function migrate() {
    console.log(`[迁移] 目标: ${active}`);
    const columns = await query('SHOW COLUMNS FROM devices');
    const columnNames = columns.map(c => c.Field);

    if (!columnNames.includes('spec_model')) {
        await query("ALTER TABLE devices ADD COLUMN spec_model VARCHAR(200) DEFAULT NULL COMMENT '规格型号'");
        console.log('✅ 添加 spec_model 字段');
    } else {
        console.log('spec_model 字段已存在');
    }

    if (!columnNames.includes('source')) {
        await query("ALTER TABLE devices ADD COLUMN source VARCHAR(200) DEFAULT NULL COMMENT '来源'");
        console.log('✅ 添加 source 字段');
    } else {
        console.log('source 字段已存在');
    }

    console.log('✅ 数据库迁移完成');
    pool.end();
}

migrate().catch(err => {
    console.error('迁移失败:', err);
    pool.end();
    process.exit(1);
});
