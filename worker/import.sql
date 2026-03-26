-- 导入原有数据到 D1 (SQLite 语法)

INSERT INTO warehouses (id, name, type, description, created_at, updated_at) VALUES (1, '工作仓库', 'work', '办公设备存放', '2026-03-19 11:59:42', '2026-03-19 11:59:42');
INSERT INTO warehouses (id, name, type, description, created_at, updated_at) VALUES (2, '家居仓库', 'home', '家居物品存放', '2026-03-19 11:59:42', '2026-03-19 11:59:42');

INSERT INTO devices (id, warehouse_name, name, tag_name, status, quantity, storage_location, location_status, destination, remark, checkin_time, created_at, updated_at) VALUES (1, '工作仓库', 'Dell电脑主机', '电脑', '正常', 1, '', 'in_stock', '', '', '2026-03-19 11:59:42', '2026-03-19 11:59:42', '2026-03-19 11:59:42');
INSERT INTO devices (id, warehouse_name, name, tag_name, status, quantity, storage_location, location_status, destination, remark, checkin_time, created_at, updated_at) VALUES (2, '工作仓库', '27寸显示器', '显示器', '正常', 2, '', 'in_stock', '', '', '2026-03-19 11:59:42', '2026-03-19 11:59:42', '2026-03-19 11:59:42');
INSERT INTO devices (id, warehouse_name, name, tag_name, status, quantity, storage_location, location_status, destination, remark, checkin_time, created_at, updated_at) VALUES (3, '家居仓库', 'HDMI线', '线缆', '正常', 5, '', 'in_stock', '', '2米规格', '2026-03-19 11:59:42', '2026-03-19 11:59:42', '2026-03-19 11:59:42');
INSERT INTO devices (id, warehouse_name, name, tag_name, status, quantity, storage_location, location_status, destination, remark, checkin_time, created_at, updated_at) VALUES (4, '家居仓库', '无线鼠标', '配件', '正常', 3, '', 'checked_out', '借用', '', '2026-03-19 11:59:42', '2026-03-19 11:59:42', '2026-03-19 12:36:30');
INSERT INTO devices (id, warehouse_name, name, tag_name, status, quantity, storage_location, location_status, destination, remark, checkin_time, created_at, updated_at) VALUES (5, '工作仓库', '借用显示器', '显示器', '正常', 1, '', 'checked_out', '同事张三借用', '已出库测试', '2026-03-19 12:10:16', '2026-03-19 12:10:16', '2026-03-19 12:10:16');
INSERT INTO devices (id, warehouse_name, name, tag_name, status, quantity, storage_location, location_status, destination, remark, checkin_time, created_at, updated_at) VALUES (6, '工作仓库', '移动硬盘', '配件', '正常', 1, '', 'checked_out', '项目A使用中', '', '2026-03-19 12:10:16', '2026-03-19 12:10:16', '2026-03-19 12:10:16');

INSERT INTO tags (id, name, created_at) VALUES (1, '电脑', '2026-03-19 11:59:42');
INSERT INTO tags (id, name, created_at) VALUES (2, '显示器', '2026-03-19 11:59:42');
INSERT INTO tags (id, name, created_at) VALUES (3, '配件', '2026-03-19 11:59:42');
INSERT INTO tags (id, name, created_at) VALUES (4, '线缆', '2026-03-19 11:59:42');
INSERT INTO tags (id, name, created_at) VALUES (5, '电器', '2026-03-19 11:59:42');
INSERT INTO tags (id, name, created_at) VALUES (6, '家具', '2026-03-19 11:59:42');
INSERT INTO tags (id, name, created_at) VALUES (7, '办公设备', '2026-03-19 11:59:42');
INSERT INTO tags (id, name, created_at) VALUES (8, '酒类', '2026-03-19 11:59:42');
INSERT INTO tags (id, name, created_at) VALUES (9, '其他', '2026-03-19 11:59:42');

INSERT INTO device_tags (device_id, tag_id) VALUES (1, 1);
INSERT INTO device_tags (device_id, tag_id) VALUES (2, 2);
INSERT INTO device_tags (device_id, tag_id) VALUES (3, 4);
INSERT INTO device_tags (device_id, tag_id) VALUES (4, 3);
