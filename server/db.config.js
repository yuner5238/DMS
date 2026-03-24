// 数据库配置文件
// 修改 active 为 'local' 或 'cloud' 来切换数据库连接

const active = 'cloud'; // 'local' 或 'cloud'

const dbConfig = {
    local: {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: 'root',
        database: 'DMS'
    },
    cloud: {
        host: 'gateway01.ap-northeast-1.prod.aws.tidbcloud.com',
        port: 4000,
        user: 'WYqCciHtZyezMP6.root',
        password: 'i6sVtriNBwHr4ZCj',
        database: 'DMS',
        ssl: {
            rejectUnauthorized: false
        }
    }
};

module.exports = { active, dbConfig };
