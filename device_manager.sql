-- 设备管理系统数据库导出
-- 时间: 2026-03-19T12:38:54.986Z

CREATE DATABASE IF NOT EXISTS device_manager;
USE device_manager;

-- ----------------------------
-- Table structure for device_tags
-- ----------------------------
DROP TABLE IF EXISTS device_tags;
CREATE TABLE `device_tags` (
  `device_id` int(11) NOT NULL,
  `tag_id` int(11) NOT NULL,
  PRIMARY KEY (`device_id`,`tag_id`),
  KEY `tag_id` (`tag_id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Records of device_tags
-- ----------------------------
INSERT INTO device_tags (`device_id`, `tag_id`) VALUES (1, 1);
INSERT INTO device_tags (`device_id`, `tag_id`) VALUES (2, 2);
INSERT INTO device_tags (`device_id`, `tag_id`) VALUES (3, 4);
INSERT INTO device_tags (`device_id`, `tag_id`) VALUES (4, 3);

-- ----------------------------
-- Table structure for devices
-- ----------------------------
DROP TABLE IF EXISTS devices;
CREATE TABLE `devices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `warehouse_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT '正常',
  `quantity` int(11) DEFAULT '1',
  `location_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'in_stock',
  `destination` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `warehouse_id` (`warehouse_name`)
) ENGINE=MyISAM AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Records of devices
-- ----------------------------
INSERT INTO devices (`id`, `warehouse_name`, `name`, `category`, `status`, `quantity`, `location_status`, `destination`, `remark`, `created_at`, `updated_at`) VALUES (1, '工作仓库', 'Dell电脑主机', '电脑', '正常', 1, 'in_stock', NULL, '', '2026-03-19 11:59:42', '2026-03-19 11:59:42');
INSERT INTO devices (`id`, `warehouse_name`, `name`, `category`, `status`, `quantity`, `location_status`, `destination`, `remark`, `created_at`, `updated_at`) VALUES (2, '工作仓库', '27寸显示器', '显示器', '正常', 2, 'in_stock', NULL, '', '2026-03-19 11:59:42', '2026-03-19 11:59:42');
INSERT INTO devices (`id`, `warehouse_name`, `name`, `category`, `status`, `quantity`, `location_status`, `destination`, `remark`, `created_at`, `updated_at`) VALUES (3, '家居仓库', 'HDMI线', '线缆', '正常', 5, 'in_stock', NULL, '2米规格', '2026-03-19 11:59:42', '2026-03-19 11:59:42');
INSERT INTO devices (`id`, `warehouse_name`, `name`, `category`, `status`, `quantity`, `location_status`, `destination`, `remark`, `created_at`, `updated_at`) VALUES (4, '家居仓库', '无线鼠标', '配件', '正常', 3, 'checked_out', '借用', '', '2026-03-19 11:59:42', '2026-03-19 12:36:30');
INSERT INTO devices (`id`, `warehouse_name`, `name`, `category`, `status`, `quantity`, `location_status`, `destination`, `remark`, `created_at`, `updated_at`) VALUES (5, '工作仓库', '借用显示器', '显示器', '正常', 1, 'checked_out', '同事张三借用', '已出库测试', '2026-03-19 12:10:16', '2026-03-19 12:10:16');
INSERT INTO devices (`id`, `warehouse_name`, `name`, `category`, `status`, `quantity`, `location_status`, `destination`, `remark`, `created_at`, `updated_at`) VALUES (6, '工作仓库', '移动硬盘', '配件', '正常', 1, 'checked_out', '项目A使用中', '', '2026-03-19 12:10:16', '2026-03-19 12:10:16');

-- ----------------------------
-- Table structure for tags
-- ----------------------------
DROP TABLE IF EXISTS tags;
CREATE TABLE `tags` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=MyISAM AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Records of tags
-- ----------------------------
INSERT INTO tags (`id`, `name`, `created_at`) VALUES (1, '电脑', '2026-03-19 11:59:42');
INSERT INTO tags (`id`, `name`, `created_at`) VALUES (2, '显示器', '2026-03-19 11:59:42');
INSERT INTO tags (`id`, `name`, `created_at`) VALUES (3, '配件', '2026-03-19 11:59:42');
INSERT INTO tags (`id`, `name`, `created_at`) VALUES (4, '线缆', '2026-03-19 11:59:42');
INSERT INTO tags (`id`, `name`, `created_at`) VALUES (5, '电器', '2026-03-19 11:59:42');
INSERT INTO tags (`id`, `name`, `created_at`) VALUES (6, '家具', '2026-03-19 11:59:42');
INSERT INTO tags (`id`, `name`, `created_at`) VALUES (7, '办公设备', '2026-03-19 11:59:42');
INSERT INTO tags (`id`, `name`, `created_at`) VALUES (8, '酒类', '2026-03-19 11:59:42');
INSERT INTO tags (`id`, `name`, `created_at`) VALUES (9, '其他', '2026-03-19 11:59:42');

-- ----------------------------
-- Table structure for warehouses
-- ----------------------------
DROP TABLE IF EXISTS warehouses;
CREATE TABLE `warehouses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT 'other',
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=MyISAM AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Records of warehouses
-- ----------------------------
INSERT INTO warehouses (`id`, `name`, `type`, `description`, `created_at`, `updated_at`) VALUES (1, '工作仓库', 'work', '办公设备存放', '2026-03-19 11:59:42', '2026-03-19 11:59:42');
INSERT INTO warehouses (`id`, `name`, `type`, `description`, `created_at`, `updated_at`) VALUES (2, '家居仓库', 'home', '家居物品存放', '2026-03-19 11:59:42', '2026-03-19 11:59:42');
INSERT INTO warehouses (`id`, `name`, `type`, `description`, `created_at`, `updated_at`) VALUES (3, '2', 'work', '', '2026-03-19 12:34:48', '2026-03-19 12:34:48');

