# DMS - 仓库资产管理系统

## 项目简介

多仓库资产管理系统，支持多仓库管理、资产标签分类、出入库管理、实时标签统计。

---

## 访问

### 云端

**在线访问**: <https://dms-2tu.pages.dev>

直接在浏览器打开即可使用，无需任何配置，数据存储在云端（Cloudflare D1）。

### 本地

```bash
# 1. 克隆项目并安装依赖
git clone <repo-url> && cd DMS
npm install

# 2. 启动服务
node server/index.js

# 3. 访问 http://localhost:3000
```

本地服务默认连接 TiDB Cloud，开箱即用；如需切换数据库见下方开发章节。

---

## 开发

### 本地开发

```bash
# 1. 克隆项目并安装依赖
git clone <repo-url> && cd DMS
npm install

# 2. 配置 .env 文件（数据库、S3 等，见下方说明）

# 3. 启动服务
node server/index.js

# 4. 访问 http://localhost:3000
```

#### 切换数据库

在 `.env` 中修改 `DB_ACTIVE`：

| 值 | 数据库 | 说明 |
| --- | --- | --- |
| `cloud` | 云端数据库 | 默认，开箱即用 |
| `local` | 本地 MySQL | 需自行搭建 MySQL |

```
DB_ACTIVE=cloud   # 云端数据库
DB_ACTIVE=local   # 本地 MySQL
```

使用本地 MySQL 时，先创建数据库再配置 `.env`：

```bash
# 1. 创建数据库（在 MySQL 中执行）
mysql -u root -p < local_database.sql

# 2. 修改 .env 中的本地数据库配置
DB_LOCAL_HOST=127.0.0.1
DB_LOCAL_PORT=3306
DB_LOCAL_USER=root
DB_LOCAL_PASSWORD=你的密码
DB_LOCAL_DATABASE=DMS
```

> 修改后需重启服务器生效。

#### 切换对象存储（S3）

支持多套 S3 仓库通过 `.env` 中 `S3_ACTIVE` 快速切换：

```env
# .env
S3_ACTIVE=config1   # 激活 config1
```

每个仓库配置对应一组 `S3_CONFIG{N}_*` 变量：

```env
# 仓库 1
S3_CONFIG1_ENDPOINT=https://s3.example.com
S3_CONFIG1_BUCKET=my-bucket
S3_CONFIG1_PUBLIC_URL=https://pub.example.com
# ... 其他配置项

# 仓库 2
S3_CONFIG2_ENDPOINT=https://s3.another.com
S3_CONFIG2_BUCKET=another-bucket
S3_CONFIG2_PUBLIC_URL=https://pub.another.com
```

新增仓库只需加一组 `S3_CONFIG3_*`、`S3_CONFIG4_*` …，然后改 `S3_ACTIVE` 即可，无需改代码。配置模块 `server/s3.config.js` 自动读取。

> 修改后需重启服务器生效。

### 云端部署

项目通过 GitHub Actions 自动部署到 Cloudflare：

| 组件 | 平台 | 说明 |
| --- | --- | --- |
| 前端 | Cloudflare Pages | `public/` + `functions/` |
| 后端 | Cloudflare Workers | `worker/` |
| 数据库 | Cloudflare D1 | 数据存储 |

详见下方 [GitHub Actions 自动部署](#github-actions-自动部署) 章节。

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
| GET | `/api/tag-stats` | 标签统计（从 devices 表实时统计） |

---

## 数据库结构

### 表清单

| 表名 | 说明 |
| --- | --- |
| `warehouses` | 仓库表 |
| `devices` | 设备表（含 tag\_name 字段） |
| `announcements` | 公告表 |

> **注意**：标签不再使用独立的 `tags` 表管理，而是直接从 `devices.tag_name` 字段动态提取。标签统计也基于此实现。

---

### warehouses（仓库表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER | 主键，自增 |
| `name` | TEXT | 仓库名称（必填） |
| `type` | TEXT | 仓库类型，默认 `other` |
| `description` | TEXT | 描述 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

---

### devices（设备表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER | 主键，自增 |
| `warehouse_name` | TEXT | 所属仓库名称 |
| `name` | TEXT | 设备名称（必填） |
| `tag_name` | TEXT | 标签名称 |
| `status` | TEXT | 状态：`正常`、`维修中`、`已报废`，默认 `正常` |
| `quantity` | INTEGER | 数量，默认 `1` |
| `storage_location` | TEXT | 存放位置 |
| `location_status` | TEXT | 位置状态：`in_stock`（在库）、`checked_out`（借出） |
| `destination` | TEXT | 去向（借出时填写） |
| `remark` | TEXT | 备注 |
| `checkin_time` | DATETIME | 入库时间 |
| `checkout_time` | DATETIME | 出库时间 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

---

### announcements（公告表）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER | 主键，自增 |
| `content` | TEXT | 公告内容（必填） |
| `created_at` | DATETIME | 创建时间 |

---

## GitHub Actions 自动部署

项目通过 GitHub Actions 实现自动部署和数据库同步。

### 工作流

| 工作流 | 触发条件 | 说明 |
| --- | --- | --- |
| Deploy Pages Frontend | push 到 `public/**`/`functions/**` | 自动部署前端到 Cloudflare Pages |
| Deploy Worker Backend | push 到 `worker/**` | 自动部署后端到 Cloudflare Workers |
| Sync D1 to TiDB | 每天 10:00 或手动触发 | 将 D1 数据同步到 TiDB |
| Sync TiDB to D1 | 手动触发 | 将 TiDB 数据同步到 D1 |

### 需要的 GitHub Secrets

在仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 用途 | 说明 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Pages/Worker 部署 | 在 Cloudflare → My Profile → API Tokens 创建 |
| `CF_EMAIL` | 同步脚本认证 | Cloudflare 注册邮箱 |
| `CF_API_KEY` | 同步脚本认证 | Cloudflare → My Profile → Global API Key |
| `DB_TIDB_HOST` | TiDB 连接 | TiDB Cloud 连接地址 |
| `DB_TIDB_PORT` | TiDB 连接 | 端口（默认 4000） |
| `DB_TIDB_USER` | TiDB 连接 | TiDB Cloud 用户名 |
| `DB_TIDB_PASSWORD` | TiDB 连接 | TiDB Cloud 密码 |
| `DB_TIDB_DATABASE` | TiDB 连接 | 数据库名（DMS） |

### 创建 Cloudflare API Token

**Pages/Worker 部署用**（`CLOUDFLARE_API_TOKEN`）：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. My Profile → API Tokens → Create Token
3. 选择 Custom token，权限设置：
   - `Cloudflare Pages` → Edit
   - `Cloudflare Workers Scripts` → Edit
4. 创建后复制 Token，填入 GitHub Secrets

**D1 同步用**（`CF_API_KEY`）：

1. My Profile → API Tokens → 滚动到底部
2. Global API Key → View → 复制 Key
3. 填入 GitHub Secrets 的 `CF_API_KEY`

---

## 常用网址

| 平台 | 网址 |
| --- | --- |
| 在线访问 | <https://dms-2tu.pages.dev> |
| Cloudflare Dashboard | <https://dash.cloudflare.com/> |
| TiDB Cloud | <https://tidbcloud.com/> |
| GitHub Actions | <https://github.com/> |
