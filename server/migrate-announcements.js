const mysql = require('mysql');
const { active, dbConfig } = require('./db.config');

const pool = mysql.createPool({
    ...dbConfig[active],
    connectionLimit: 10
});

const query = (sql, values = []) => {
    return new Promise((resolve, reject) => {
        pool.query(sql, values, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};

async function migrateAnnouncements() {
    try {
        console.log('正在创建公告表...');

        // 检查表是否已存在
        const tables = await query("SHOW TABLES LIKE 'announcements'");
        if (tables.length > 0) {
            console.log('✅ 公告表已存在，跳过创建');
        } else {
            await query(`
                CREATE TABLE IF NOT EXISTS announcements (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    content TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            console.log('✅ 公告表创建成功');
        }

        console.log('\n迁移完成！');
        process.exit(0);
    } catch (err) {
        console.error('❌ 迁移失败:', err.message);
        process.exit(1);
    }
}

migrateAnnouncements();
