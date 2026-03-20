const mysql = require('mysql');

const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'device_manager',
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

async function checkDuplicates() {
    // 检查 device_tags 表中是否有重复记录
    const sql = `
        SELECT device_id, tag_id, COUNT(*) as cnt
        FROM device_tags
        GROUP BY device_id, tag_id
        HAVING cnt > 1
    `;
    const duplicates = await query(sql);
    
    if (duplicates.length > 0) {
        console.log('发现重复的标签关联:');
        console.table(duplicates);
        
        // 删除重复记录，只保留一条
        for (const dup of duplicates) {
            await query(`
                DELETE FROM device_tags
                WHERE id IN (
                    SELECT id FROM (
                        SELECT id
                        FROM device_tags
                        WHERE device_id = ? AND tag_id = ?
                        ORDER BY id DESC
                        LIMIT ?
                    ) AS t
                )
            `, [dup.device_id, dup.tag_id, dup.cnt - 1]);
            console.log(`已清理 device_id=${dup.device_id}, tag_id=${dup.tag_id} 的重复记录`);
        }
    } else {
        console.log('没有发现重复的标签关联');
    }
    
    pool.end();
}

checkDuplicates().catch(console.error);
