USE device_manager;

INSERT INTO warehouses (id, name, type, description, tags) VALUES 
(1, '工作仓库', 'work', '办公设备存放', '["电脑", "显示器"]'),
(2, '家居仓库', 'home', '家居物品存放', '["电器", "家具"]');

INSERT INTO assets (id, warehouse_id, name, category, status, quantity, remark, tags) VALUES 
(1, 1, 'Dell电脑主机', '电脑', '正常', 1, '', '["电脑"]'),
(2, 1, '27寸显示器', '显示器', '正常', 2, '', '["显示器"]'),
(3, 2, 'HDMI线', '线缆', '正常', 5, '2米规格', '["线缆"]'),
(4, 2, '无线鼠标', '配件', '正常', 3, '', '["配件"]');
