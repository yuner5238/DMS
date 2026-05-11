# DMS - 仓库资产管理系统

## 项目简介

多仓库资产管理系统，支持多仓库管理、资产标签分类、出入库管理、实时标签统计。

---

## 快速开始

### 云端使用（直接访问）

**在线访问**: <https://dms-2tu.pages.dev>

直接在浏览器打开即可使用，数据存储在云端（Cloudflare D1）。

### 本地开发

```bash
# 1. 配置数据库连接
# 编辑 .env 文件

# 2. 安装依赖
npm install

# 3. 启动服务
node server/index.js

# 4. 访问 http://localhost:3000
```

#### 切换数据库

在 `.env` 中修改 `DB_ACTIVE`：

| 值 | 数据库 | 说明 |
| --- | --- | --- |
| `cloud` | TiDB Cloud | 云端数据库（默认） |
| `local` | 本地 MySQL | 需要本地搭建 MySQL |

```
DB_ACTIVE=cloud   # 切换为 TiDB Cloud
DB_ACTIVE=local   # 切换为本地 MySQL
```

> 修改后需重启服务器生效。

---

## 项目结构

### 架构图

| 层级 | 本地开发 | 云端部署 |
| --- | --- | --- |
| 访问地址 | `localhost:3000` | `dms-2tu.pages.dev` |
| **前端** | `public/` | Pages（`dms`） |
| **后端** | Node.js（`server/index.js`） | Workers（`dms-worker`） |
| **数据库** | TiDB | D1（`dms-db`） |

**数据流向**：用户浏览器 → 前端 → 后端 → 数据库

### 代码目录

```
DMS/
├── public/              # 前端页面
│   ├── index.html
│   └── device.html
├── server/              # 本地后端（Node.js）
│   └── index.js
├── worker/              # 云端后端（Workers）
│   ├── index.js
│   ├── wrangler.toml
│   └── *.sql
├── .env                 # 数据库配置（勿提交）
├── wrangler.toml        # Pages 配置
├── package.json
└── 启动服务器.bat
```

> 前端根据访问域名自动切换后端，无需手动配置。

---

## 功能

- 仓库 CRUD、设备 CRUD、标签管理
- 出入库管理（在库/借出）
- 标签统计、搜索排序
- 富文本备注

---

## API 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/warehouses` | 获取所有仓库 |
| POST | `/api/warehouses` | 创建仓库 |
| PUT | `/api/warehouses/:id` | 更新仓库 |
| DELETE | `/api/warehouses/:id` | 删除仓库 |
| GET | `/api/devices` | 获取设备列表 |
| GET | `/api/devices/:id` | 获取单个设备 |
| POST | `/api/devices` | 创建设备 |
| PUT | `/api/devices/:id` | 更新设备 |
| DELETE | `/api/devices/:id` | 删除设备 |
| GET | `/api/tags` | 获取标签列表 |
| POST | `/api/tags` | 创建标签 |
| PUT | `/api/tags/:id` | 更新标签 |
| DELETE | `/api/tags/:id` | 删除标签 |
| GET | `/api/tag-stats` | 标签统计 |

---

## 常用网址

| 平台 | 网址 |
| --- | --- |
| 在线访问 | <https://dms-2tu.pages.dev> |
| Cloudflare Dashboard | <https://dash.cloudflare.com/> |
| TiDB Cloud | <https://tidbcloud.com/> |
