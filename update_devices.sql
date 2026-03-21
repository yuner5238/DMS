-- 补充设备表完整信息
USE device_manager;

-- 更新设备1：Dell电脑主机
UPDATE devices SET
    remark = 'Intel i7处理器，16GB内存，512GB SSD，Windows 11系统，办公专用设备'
WHERE id = 1;

-- 更新设备2：27寸显示器
UPDATE devices SET
    remark = '4K分辨率，HDMI/DP接口，护眼模式，品牌：AOC'
WHERE id = 2;

-- 更新设备3：HDMI线
UPDATE devices SET
    remark = '2米规格，支持4K 60Hz传输，镀金接口，高速传输线缆'
WHERE id = 3;

-- 更新设备4：无线鼠标
UPDATE devices SET
    remark = '蓝牙5.0连接，1600DPI，静音设计，可充电电池，罗技品牌'
WHERE id = 4;

-- 更新设备5：借用显示器
UPDATE devices SET
    remark = '24寸1080P显示器，借用给同事张三，预计归还时间：2026年4月15日'
WHERE id = 5;

-- 更新设备6：移动硬盘
UPDATE devices SET
    remark = '1TB存储容量，USB 3.0接口，加密保护，用于项目A数据备份'
WHERE id = 6;

-- 查询更新结果
SELECT id, warehouse_name, name, category, status, quantity, destination, remark
FROM devices
ORDER BY id;
