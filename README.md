# 仓库资产管理系统

## 项目简介

一个基于 Node.js + Express + MySQL 的多仓库资产管理系统，支持：
- 多仓库管理（工作仓库、家居仓库等）
- 资产标签分类
- 资产出入库管理
- 实时标签统计

## 环境要求

- Node.js 16+
- MySQL 8.0+
- Navicat（可选，用于数据库管理）

## 数据库配置

系统使用 MySQL 数据库，配置如下：
- **主机**: 127.0.0.1
- **端口**: 3306
- **数据库名**: device_manager
- **用户名**: root
- **密码**: root

### 数据库表结构

#### 1. warehouses（仓库表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键，自增 |
| name | VARCHAR(100) | 仓库名称 |
| type | VARCHAR(20) | 仓库类型：work(工作)/home(家居)/other(其他) |
| description | TEXT | 仓库描述 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

#### 2. devices（设备/资产表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键，自增 |
| warehouse_name | VARCHAR(100) | 所属仓库名称 |
| name | VARCHAR(200) | 资产名称 |
| category | VARCHAR(50) | 资产类别 |
| status | VARCHAR(20) | 状态：正常/异常/维修中 |
| quantity | INT | 数量 |
| location_status | VARCHAR(20) | 位置状态：in_stock(在库)/checked_out(借出) |
| destination | VARCHAR(200) | 去向（借出时填写） |
| remark | TEXT | 备注 |
| checkin_time | DATETIME | 入库时间 |
| checkout_time | DATETIME | 出库时间 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

#### 3. tags（标签表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键，自增 |
| name | VARCHAR(50) | 标签名称 |
| created_at | TIMESTAMP | 创建时间 |

#### 4. device_tags（资产标签关联表）
| 字段 | 类型 | 说明 |
|------|------|------|
| device_id | INT | 资产ID |
| tag_id | INT | 标签ID |

## 快速开始

### 1. 启动 MySQL 服务
确保 MySQL 服务正在运行，且已创建 `device_manager` 数据库。

### 2. 启动应用服务
**方式一：双击启动（推荐）**
```
双击运行：启动服务.bat
```

**方式二：命令行启动**
```bash
cd "C:\Users\yuner\Desktop\设备管理系统"
npm start
```

### 3. 访问系统
打开浏览器访问：http://localhost:3001

### 4. 停止服务
关闭黑窗口即可停止服务。

## 功能说明

### 仓库管理
- **创建仓库**：点击侧边栏「新建仓库」按钮
- **编辑仓库**：鼠标悬停在仓库卡片上，点击铅笔图标
- **删除仓库**：鼠标悬停在仓库卡片上，点击垃圾桶图标
- **切换仓库**：点击仓库卡片查看该仓库的资产

### 资产管理
- **添加资产**：选择仓库后，点击「添加资产」按钮
- **编辑资产**：点击资产卡片右侧的编辑按钮
- **删除资产**：点击资产卡片右侧的删除按钮
- **搜索资产**：在搜索框输入关键词（支持名称、标签搜索）

### 标签管理
- **查看标签**：侧边栏「标签统计」区域显示所有标签
- **添加标签**：在添加/编辑资产时输入新标签，系统会自动创建
- **标签统计**：每个标签显示关联的资产数量和总数量

### 资产状态
- **正常**：绿色标签
- **异常**：红色标签
- **维修中**：黄色标签

### 出入库管理
- **入库**：添加资产时选择「在库」，自动记录入库时间
- **出库**：编辑资产时选择「借出」，填写去向和出库时间

## API 接口

### 仓库 API
- `GET /api/warehouses` - 获取所有仓库
- `POST /api/warehouses` - 添加仓库
- `PUT /api/warehouses/:id` - 更新仓库
- `DELETE /api/warehouses/:id` - 删除仓库

### 资产 API
- `GET /api/devices` - 获取所有资产
- `GET /api/devices?warehouseId=1` - 按仓库获取资产
- `POST /api/devices` - 添加资产
- `PUT /api/devices/:id` - 更新资产
- `DELETE /api/devices/:id` - 删除资产

### 标签 API
- `GET /api/tags` - 获取所有标签
- `POST /api/tags` - 添加标签
- `PUT /api/tags/:id` - 更新标签
- `DELETE /api/tags/:id` - 删除标签
- `GET /api/tag-stats` - 获取标签统计

## 项目结构

```
设备管理系统/
├── public/                 # 前端文件
│   └── index.html         # 主页面
├── server/                # 后端文件
│   └── index.js          # 服务端入口
├── node_modules/          # 依赖包
├── package.json          # 项目配置
├── package-lock.json     # 依赖锁定
├── device_manager.sql    # 数据库备份（可选）
├── 启动服务.bat          # Windows启动脚本
└── README.md             # 本文件
```

## 注意事项

1. **MySQL 服务**：启动前确保 MySQL 服务正在运行
2. **数据库**：确保 `device_manager` 数据库已创建
3. **表结构**：首次使用需要创建数据表（可使用 device_manager.sql 导入）
4. **端口占用**：服务使用 3001 端口，确保该端口未被占用
5. **删除仓库**：删除仓库会同时删除该仓库下的所有资产，请谨慎操作

## 故障排除

### 1. 无法连接数据库
- 检查 MySQL 服务是否启动
- 检查数据库配置（用户名、密码、数据库名）
- 检查数据库 `device_manager` 是否存在

### 2. 端口被占用
- 检查 3001 端口是否被其他程序占用
- 修改 `server/index.js` 中的 `PORT` 变量更换端口

### 3. 页面空白或报错
- 检查浏览器控制台错误信息
- 确保所有依赖已安装（运行 `npm install`）
- 检查 MySQL 表结构是否正确

## 技术支持

如有问题，请检查：
1. MySQL 服务是否运行
2. 数据库连接配置是否正确
3. 端口 3001 是否被占用
4. 浏览器控制台是否有错误信息
