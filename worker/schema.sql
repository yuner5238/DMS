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
    warehouse_name TEXT,
    name TEXT NOT NULL,
    tag_name TEXT DEFAULT '',
    status TEXT DEFAULT '正常',
    quantity INTEGER DEFAULT 1,
    storage_location TEXT DEFAULT '',
    location_status TEXT DEFAULT 'in_stock',
    destination TEXT DEFAULT '',
    remark TEXT DEFAULT '',
    checkin_time DATETIME,
    checkout_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 标签表
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 设备标签关联表
CREATE TABLE IF NOT EXISTS device_tags (
    device_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (device_id, tag_id)
);
