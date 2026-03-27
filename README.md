# DMS - 仓库资产管理系统

## 项目简介

多仓库资产管理系统，支持多仓库管理、资产标签分类、出入库管理、实时标签统计。

---

## 项目结构

```
DMS/
├── public/              # 前端页面（自动切换环境）
│   ├── index.html       # 主页面
│   └── device.html      # 设备详情页
├── server/              # 本地后端（Node.js + TiDB）
│   └── index.js
├── worker/              # 云端后端（Cloudflare Workers + D1）
│   ├── index.js
│   ├── wrangler.toml
│   ├── schema.sql
│   └── import.sql
├── wrangler.toml        # Pages 静态托管配置
├── package.json
└── 启动服务器.bat
```

---

## 环境要求

| 模式  | 要求                                                    |
| --- | ----------------------------------------------------- |
| 本地  | Node.js 16+、TiDB 云数据库                                 |
| 云端  | Cloudflare 账号、Wrangler CLI（`npm install -g wrangler`） |

---

## 本地开发（Node.js + TiDB）

### 架构

| 组件  | 位置                        | 说明                                                                         |
| --- | ------------------------- | -------------------------------------------------------------------------- |
| 前端  | `public/`（本地项目目录）         | HTML + Bootstrap 静态页面，由 Node.js 托管                                         |
| 后端  | `server/index.js`（本地项目目录） | Express 服务，监听 3000 端口                                                      |
| 数据库 | TiDB Cloud（云端）            | `gateway01.ap-northeast-1.prod.aws.tidbcloud.com:4000`，数据库名 `DMS`，MySQL 协议 |

### 连接方式

- 前端访问 `http://localhost:3000`，API 请求走 `/api` → Node.js 后端 → TiDB Cloud

- 数据库连接配置在 `.env` 文件中：
  
  ```
  DB_CLOUD_HOST=gateway01.ap-northeast-1.prod.aws.tidbcloud.com
  DB_CLOUD_PORT=4000
  DB_CLOUD_USER=WYqCciHtZyezMP6.root
  DB_CLOUD_PASSWORD=******
  DB_CLOUD_DATABASE=DMS
  ```

### 启动方式

**方式一：双击启动（推荐）**

```
双击运行：启动服务器.bat
```

**方式二：命令行启动**

```bash
# 1. 安装依赖
npm install

# 2. 启动本地后端
node server/index.js

# 3. 访问 http://localhost:3000
```

---

## 云端部署（Workers + D1）

### 架构

| 组件  | 位置                             | 说明                                                     |
| --- | ------------------------------ | ------------------------------------------------------ |
| 前端  | Cloudflare Pages（全球 CDN）       | `https://dms-2tu.pages.dev`，纯静态托管                      |
| 后端  | Cloudflare Workers（Serverless） | `https://dms-worker.171519019.workers.dev`，D1 绑定名 `DB` |
| 数据库 | Cloudflare D1（云端）              | 数据库名 `dms-db`，SQLite 协议                                |

### 连接方式

- 前端访问 `https://dms-2tu.pages.dev`，API 请求自动转发到 Worker 后端 → D1
- Worker 通过环境绑定 `DB` 连接 D1，无需连接字符串

### 部署

```bash
# 1. 部署 Worker 后端（在 DMS/worker/ 目录下执行）
cd C:\Users\yuner\Documents\My_Workspace\code\DMS\worker
npx wrangler deploy

# 2. 部署前端到 Pages（在 DMS/ 目录下执行）
cd C:\Users\yuner\Documents\My_Workspace\code\DMS
npx wrangler pages deploy public --project-name=dms --commit-dirty=true
```

### D1 数据库导入导出

```bash
# 在 DMS/ 目录下执行

# 导出（备份）线上数据库到 SQL 文件
npx wrangler d1 export dms-db --remote --output=backup.sql

# 导入（恢复）SQL 文件到线上数据库
npx wrangler d1 execute dms-db --remote --file=./backup.sql
```

> 也可以在 Cloudflare Dashboard → Workers & Pages → D1 → dms-db → Console 中在线执行 SQL 语句。

---

## 环境自动切换

前端根据访问域名自动判断使用哪个后端，无需手动修改代码：

| 访问地址                        | 后端                                   | 数据库           |
| --------------------------- | ------------------------------------ | ------------- |
| `http://localhost:3000`     | 本地 Node.js（`server/index.js`）        | TiDB Cloud    |
| `https://dms-2tu.pages.dev` | Cloudflare Worker（`worker/index.js`） | Cloudflare D1 |

---

## 功能

- 仓库 CRUD、设备 CRUD、标签管理
- 出入库管理（在库/借出）
- 标签统计、搜索排序
- 富文本备注

---

## API 接口

| 方法     | 路径                    | 说明     |
| ------ | --------------------- | ------ |
| GET    | `/api/warehouses`     | 获取所有仓库 |
| POST   | `/api/warehouses`     | 创建仓库   |
| PUT    | `/api/warehouses/:id` | 更新仓库   |
| DELETE | `/api/warehouses/:id` | 删除仓库   |
| GET    | `/api/devices`        | 获取设备列表 |
| GET    | `/api/devices/:id`    | 获取单个设备 |
| POST   | `/api/devices`        | 创建设备   |
| PUT    | `/api/devices/:id`    | 更新设备   |
| DELETE | `/api/devices/:id`    | 删除设备   |
| GET    | `/api/tags`           | 获取标签列表 |
| POST   | `/api/tags`           | 创建标签   |
| PUT    | `/api/tags/:id`       | 更新标签   |
| DELETE | `/api/tags/:id`       | 删除标签   |
| GET    | `/api/tag-stats`      | 标签统计   |
