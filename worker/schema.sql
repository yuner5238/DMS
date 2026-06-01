-- DMS 仓库资产管理系统 - D1 建表 SQL (SQLite 语法)
-- 与 TiDB 结构保持一致，TiDB 侧对应关系见 schema-d1-to-tidb.js

-- 仓库表
CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'other',
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 设备表
-- 注意: tag_names/remark 在 TiDB 侧为 TEXT 类型，TEXT 不支持 DEFAULT，
--       但应用层 INSERT 时始终显式传入 ''，因此实际效果一致
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT DEFAULT '',              -- TiDB: varchar(20)
    warehouse_name TEXT,
    name TEXT NOT NULL,
    tag_names TEXT DEFAULT '',              -- TiDB: text (无DEFAULT，应用层补偿)
    status TEXT DEFAULT '正常',
    quantity INTEGER DEFAULT 1,
    storage_location TEXT DEFAULT '',       -- TiDB: varchar(200)
    location_status TEXT DEFAULT 'in_stock',
    destination TEXT DEFAULT '',            -- TiDB: varchar(200)
    responsible_person TEXT DEFAULT '',     -- TiDB: varchar(100)
    department_path TEXT DEFAULT '',       -- TiDB: varchar(200) 所属路径
    serial_number TEXT DEFAULT '',         -- TiDB: varchar(200) 序列号
    remark TEXT DEFAULT '',                 -- TiDB: text (无DEFAULT，应用层补偿)
    expiry_date DATE DEFAULT NULL,
    checkin_time DATETIME,
    checkout_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 公告表
CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
