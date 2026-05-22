-- DMS 仓库资产管理系统 - D1 建表 SQL (SQLite 语法)

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
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT DEFAULT '',
    warehouse_name TEXT,
    name TEXT NOT NULL,
    tag_names TEXT DEFAULT '',
    status TEXT DEFAULT '正常',
    quantity INTEGER DEFAULT 1,
    storage_location TEXT DEFAULT '',
    location_status TEXT DEFAULT 'in_stock',
    destination TEXT DEFAULT '',
    remark TEXT DEFAULT '',
    expiry_date DATE DEFAULT NULL,           -- 到期日期
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
