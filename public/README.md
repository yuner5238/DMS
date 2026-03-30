# DMS - 仓库资产管理系统

## 项目简介

多仓库资产管理系统，支持多仓库管理、资产标签分类、出入库管理、实时标签统计。

---

## 常用网址

| 平台 | 网址 | 说明 |
| --- | --- | --- |
| Cloudflare Dashboard | [https://dash.cloudflare.com/](https://dash.cloudflare.com/) | Cloudflare 控制台，用于管理 Workers（后端）、Pages（前端）、D1（数据库）等服务 |
| TiDB Cloud | [https://tidbcloud.com/](https://tidbcloud.com/) | TiDB 云数据库控制台，用于管理本地开发环境的数据库 |

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
├── functions_deprecated_not_used/  # ⚠️ 已废弃，不再使用（旧版 Pages Functions 后端代码）
│   └── api/
│       ├── warehouses/
│       ├── devices/
│       ├── tags/
│       └── tag-stats/
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
| 数据库 | TiDB Cloud（云端）            | 连接信息配置在 `.env` 文件中（参考 `.env.example`）                              |

### 连接方式

- 前端访问 `http://localhost:3000`，API 请求走 `/api` → Node.js 后端 → TiDB Cloud
- 数据库连接配置在 `.env` 文件中，参考 `.env.example` 文件进行配置：
```bash
  # 复制示例文件
  cp .env.example .env

  # 编辑 .env 文件，填写实际的数据库连接信息
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

### 更新方式

| 组件 | 更新方式 |
|------|---------|
| 前端 | 修改 `public/` 下的文件，刷新页面即可生效，无需重启 |
| 后端 | 修改 `server/index.js` 后，需 Ctrl+C 停止后重新运行 `node server/index.js` |
| 数据库 | 使用 TiDB Cloud Console 或 Navicat 直接在云端修改 |

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

**前端部署**

方式一：Git 自动部署（推荐）
1. 在 Cloudflare Dashboard → **Workers & Pages → dms → Settings → Deployment → Git** 中关联 GitHub 仓库
2. 选择 GitHub 仓库和分支（默认 `master`）
3. 配置构建选项：
   - **Framework preset**: `None`
   - **Build command**: 留空
   - **Build output directory**: `public`
4. 保存后，每次 `git push` 到 GitHub，Cloudflare 自动构建并部署

方式二：命令行部署
```bash
# 部署前端到 Pages（在 DMS/ 目录下执行）
cd C:\Users\yuner\Documents\My_Workspace\code\DMS
npx wrangler pages deploy public --project-name=dms --commit-dirty=true
```

**后端部署**

```bash
# 部署 Worker 后端（在 DMS/worker/ 目录下执行）
cd C:\Users\yuner\Documents\My_Workspace\code\DMS\worker
npx wrangler deploy
```

**数据库部署**

D1 数据库已自动绑定，无需额外部署步骤。如需初始化数据库，请参考下方"数据库操作"部分。

### 更新方式

| 组件 | 更新方式 |
|------|---------|
| 前端 | 修改 `public/` 后执行部署命令：`npx wrangler pages deploy public --project-name=dms --commit-dirty=true` |
| 后端 | 修改 `worker/index.js` 后执行部署命令：`cd worker && npx wrangler deploy` |
| 数据库 | 执行导入/导出命令（见下方）或在 Cloudflare Dashboard → D1 → dms-db → Console 中在线执行 SQL |

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
