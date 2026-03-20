const mysql = require('mysql');
const fs = require('fs');
const path = require('path');

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

async function exportDatabase() {
    const connection = await new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) reject(err);
            else resolve(connection);
        });
    });

    // 获取所有表
    const tables = await query('SHOW TABLES');
    const tableNameKey = 'Tables_in_device_manager';
    
    let sql = `-- 设备管理系统数据库导出\n-- 时间: ${new Date().toISOString()}\n\n`;
    sql += `CREATE DATABASE IF NOT EXISTS device_manager;\nUSE device_manager;\n\n`;
    
    for (const row of tables) {
        const tableName = row[tableNameKey];
        console.log(`导出表: ${tableName}`);
        
        // 获取建表语句
        const createTable = await query(`SHOW CREATE TABLE ${tableName}`);
        sql += `-- ----------------------------\n-- Table structure for ${tableName}\n-- ----------------------------\n`;
        sql += `DROP TABLE IF EXISTS ${tableName};\n`;
        sql += createTable[0]['Create Table'] + ';\n\n';
        
        // 获取数据
        const data = await query(`SELECT * FROM ${tableName}`);
        if (data.length > 0) {
            sql += `-- ----------------------------\n-- Records of ${tableName}\n-- ----------------------------\n`;
            for (const row of data) {
                const keys = Object.keys(row).map(k => `\`${k}\``).join(', ');
                const values = Object.values(row).map(v => {
                    if (v === null) return 'NULL';
                    if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
                    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
                    return v;
                }).join(', ');
                sql += `INSERT INTO ${tableName} (${keys}) VALUES (${values});\n`;
            }
            sql += '\n';
        }
    }
    
    // 写入文件
    const desktopPath = path.join(process.env.USERPROFILE, 'Desktop', 'device_manager.sql');
    fs.writeFileSync(desktopPath, '\ufeff' + sql, 'utf8');
    console.log(`✅ 已导出到: ${desktopPath}`);
    
    connection.release();
    pool.end();
}

exportDatabase().catch(console.error);
