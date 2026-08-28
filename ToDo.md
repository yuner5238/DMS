## 短期

- [ ] 补全说明文档，完善切换数据库连接方式相关说明
- [ ] 核对数据库表结构合理性
- [ ] 实现本地开发与云部署环境均可灵活切换数据库

## 安全与代码审查待办（2026-08-26 审查报告）

> 优先级说明：P0 立即处理 / P1 高优先级 / P2 架构改进 / P3 小问题

### 🔴 P0 — 立即处理（安全）

- [ ] **P0-1 S3 密钥明文提交进 Git**：`worker/wrangler.toml` 含明文 `S3_ACCESS_KEY` / `S3_SECRET_KEY`，已被 git 跟踪。
  - 去 cstcloud 控制台轮换这对密钥（已进历史，仅删文件无用）
  - 改用 `wrangler secret put S3_ACCESS_KEY` / `S3_SECRET_KEY`
  - `wrangler.toml` 中只留非敏感 vars
- [ ] **P0-2 数据库密码打印到日志**：`server/db.config.js` 的 `console.log('[DEBUG] DB Config:', ...)` 把 TiDB 明文密码写进了 `server.log`。
  - 删除该 DEBUG 日志（保留 host/port 即可）
  - 清理已有的 `server.log`
- [ ] **P0-3 全部 API 无鉴权 + 存在“一键清空”端点**：`POST /api/devices/clear-warehouse` 不传 warehouseName 时删全部设备，线上（dms-2tu.pages.dev）任何人可调；删除仓库、批量删除同理。
  - 至少加一层简单 Token 校验（前端存配置，Worker/Server 校验 `Authorization` 头），或 Cloudflare Access
- [ ] **~~P0-4 node\_modules 被提交进 Git（769 个文件）~~**~~：✅ 已完成（2026-08-26）~~
  - ~~`git rm -r --cached node_modules`~~ ~~已从索引移除，本地文件保留（共 769 个文件不再被跟踪）~~
  - ~~`.gitignore`~~ ~~已含~~ ~~`node_modules/`，不会再次被跟踪~~
  - ~~待网络恢复后执行~~ ~~`git commit`~~ ~~+~~ ~~`git push`~~ ~~生效（当前因无法连接 github.com 尚未推送）~~

### 🟠 P1 — 高优先级

- [ ] **P1-5 Markdown 附件渲染 XSS**：`server/index.js` 附件代理对 `.md` 直接 `marked.parse()` 以 `text/html` 返回且未消毒。引入 `isomorphic-dompurify`：`DOMPurify.sanitize(marked.parse(md))`
- [ ] **P1-6 device\_id 生成竞态 + D1 缺唯一约束**：`MAX(...)+1` 并发撞号；`worker/schema.sql` 无 `UNIQUE KEY device_id` 兜底。补上：
  ```sql
  CREATE UNIQUE INDEX idx_devices_device_id ON devices(device_id) WHERE device_id != '';
  ```
- [ ] **P1-7 删除仓库无事务**：先删设备再删仓库，第二步失败则数据丢失但仓库还在。MySQL 用 `conn.beginTransaction()`；D1 用 `env.DB.batch([stmt1, stmt2])`
- [ ] **P1-8 错误响应泄露内部信息**：多处 `res.json({ error: err.message })`，worker 上传接口甚至返回 `stack: err.stack`。对外只返回通用错误，详细信息留服务端日志
- [ ] **P1-9 依赖问题**：
  - `xlsx@0.18.5` 有 CVE-2023-30533、CVE-2024-22363，升级到 0.20.2+（npm 没有，需从 SheetJS 官方 CDN 装）
  - `@planetscale/database` 完全未使用，移除
  - `body-parser` 可用 `express.json()` 替代，移除
  - `mysql`(v2) 仅一次性脚本在用，可移除
- [ ] **P1-10 TiDB 连接 `rejectUnauthorized: false`**：关闭证书校验，存在中间人风险。改为 `ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }`

### 🟡 P2 — 架构改进

- [ ] **P2-11 双后端 2700 行重复代码**：`server/index.js` 与 `worker/index.js` 行为漂移（`next-code` 过滤、`updateDevice` 部分更新 vs 读合并全量写、announcements PUT 缺失）。抽 `shared/` 放字段映射、校验、日期解析，路由层只做薄封装
- [ ] **P2-12 设备用 warehouse\_name 字符串关联仓库**：改名仓库=所有设备失联。迁移到 `warehouse_id` 外键 + 改名时 UPDATE 关联
- [ ] **P2-13 导入接口 N+1 查询**：`/api/devices/import(-batch)` 每行 1 次 SELECT + 1 次 INSERT。改为一次 `SELECT device_id ... WHERE device_id IN (...)` 预查 + 多值 `INSERT ... VALUES (...),(...)`
- [ ] **P2-14 `query` 与 `queryLarge` 90% 重复**：合并为 `query(sql, values, { timeout = 30000, maxRetries = 2 } = {})`
- [ ] **P2-15 server/ 混杂 15+ 个一次性脚本**：`check-*`/`init-*`/`migrate-*`/`fix-*`/`drop-*` 移到 `scripts/`，与生产代码分离

### 🟢 P3 — 小问题

| 问题 | 位置 | 说明 |
|---|---|---|
| `device_manager.sql` 是 GBK 乱码 | 根目录 | 重新以 UTF-8 导出；引擎 MyISAM，回灌 MySQL 建议 InnoDB |
| `parseDate` 用 `new Date(v)` | server/index.js | 时区敏感，跨时区偏移一天；建议显式解析 `YYYY-MM-DD` |
| bat 脚本端口不一致 | 启动服务器.bat | 检查 3001 但提示“3000 被占用”；.env 是 3001，代码默认 3000 |
| 北京时间 hack | 两端公告 API | `+8h toISOString` 可用，更稳妥是存 UTC、显示层转 |
| CORS 全开 `*` | 两端 | 加鉴权后可收紧为同源 |
| 无分页 | GET /api/devices | 数据量增长后需加 limit/offset |
| 加密默认密钥 | encryption.js | `'dms-default-key-32chars!!'` 兜底 + CBC 无认证，建议 AES-256-GCM 且缺 key 时直接报错 |

### 建议处理顺序

1. **今天**：P0-1 轮换 S3 密钥 → wrangler secret；P0-2 删 db.config.js DEBUG 密码日志；P0-4 `git rm --cached node_modules`
2. **本周**：P0-3 API Token 鉴权；P1-6 D1 补 device\_id 唯一索引；P1-5 md 渲染加 DOMPurify；P1-9 升级 xlsx
3. **迭代**：P2-11 抽 shared 层统一双端；P2-13 导入批量化；P2-12 仓库改 ID 关联

## 长期

- [ ] 实现数据库连接配置加密处理
- [ ] 办理信用卡后，继续跟进站点申请：<https://dashboard.render.com/web/new?onboarding=active>
