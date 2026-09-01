# ToDo

## 短期

- [ ] 补全说明文档，完善切换数据库连接方式相关说明
- [ ] 核对数据库表结构合理性
- [ ] 实现本地开发与云部署环境均可灵活切换数据库

## 剩余问题清单（2026-08-26 审查，已完成项已清理）

### 🔴 P0 — 立即处理

| # | 问题 | 影响 | 方案 |
|---|---|---|---|
| P0-1 | S3 密钥明文提交进 Git（`worker/wrangler.toml`） | 拿到密钥的人可随意读写你的对象存储 | 去 cstcloud 控制台轮换密钥；改用 `wrangler secret put` 注入；toml 只留非敏感配置 |
| P0-2 | 数据库密码打印进 `server.log`（`db.config.js` 的 DEBUG 日志） | 能看到日志的人就能连库 | 删那行日志（保留 host/port）；删掉现有 `server.log` |
| P0-3 | API 全裸奔，且"清空仓库"接口任何人可调 | 一行命令删光线上全部数据 | 加 Token 校验（`Authorization` 头）或 Cloudflare Access |

### 🟠 P1 — 高优先级

| # | 问题 | 影响 | 方案 |
|---|---|---|---|
| P1-5 | 后端 `.md` 附件直接 `marked.parse()` 返回，无消毒 | 点开附件即执行其中恶意代码 | 加 `DOMPurify.sanitize(marked.parse(md))` |
| P1-6 | 设备编号 `MAX+1` 有并发竞态；D1 无唯一约束 | 云端静默出现重复编号 | D1 补 `CREATE UNIQUE INDEX idx_devices_device_id ON devices(device_id) WHERE device_id != ''` |
| P1-7 | 删除仓库分两步执行，无事务 | 第二步失败=设备丢了、仓库还在 | MySQL 用 `beginTransaction()`；D1 用 `env.DB.batch()` |
| P1-8 | 错误响应直接返回 `err.message`/`stack` | 坏人借报错摸清内部结构 | 对外只回"出错了"，详情进服务端日志 |
| P1-9 | `xlsx@0.18.5` 有 CVE；3 个依赖未使用 | 恶意 Excel 可利用漏洞；装包慢 | xlsx 升 0.20.2+（SheetJS CDN）；删 `@planetscale/database`、`body-parser`、`mysql` |
| P1-10 | TiDB SSL `rejectUnauthorized: false` | 中间人攻击无法察觉 | 改 `ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }` |

### 🟡 P2 — 架构改进

| # | 问题 | 影响 | 方案 |
|---|---|---|---|
| P2-11 | 双后端 2700 行重复代码，行为已漂移 | 改一处忘一处，bug 复发 | 抽 `shared/` 公共层，路由薄封装 |
| P2-12 | 设备用仓库名字符串关联 | 仓库改名=设备全部失联 | 迁移到 `warehouse_id` 外键 |
| P2-13 | 导入接口 N+1 查询（1000 行=2000+ 次查询） | 导入极慢 | 一次 `IN` 预查 + 多值 `INSERT` |
| P2-14 | `query` 与 `queryLarge` 90% 重复 | 维护两份 | 合并为一个带 options 的函数 |
| P2-15 | `server/` 混 15+ 个一次性脚本 | 正式代码和临时代码分不清 | 移到 `scripts/` 目录 |

### 🟢 P3 — 小问题

| # | 问题 | 影响 | 方案 |
|---|---|---|---|
| P3-1 | `device_manager.sql` GBK 乱码、MyISAM 引擎 | 文件不可用 | 重新导出 UTF-8，引擎换 InnoDB |
| P3-2 | `parseDate` 用 `new Date(v)` | 跨时区日期偏一天 | 显式解析 `YYYY-MM-DD` |
| P3-3 | bat 脚本检查 3001 但提示 3000 | 误导排障 | 改文案与代码统一 |
| P3-4 | 公告 API 手动 +8h 处理时区 | 能用但不稳 | 存 UTC、显示层转换 |
| P3-5 | CORS 全开 `*` | 任何站点都能调接口 | 加鉴权后收紧为同源 |
| P3-6 | 设备列表接口无分页 | 数据多了必卡 | 加 limit/offset |
| P3-7 | 加密用默认密钥 + CBC 无认证 | 密文可被伪造 | 换 AES-256-GCM，缺 key 直接报错 |

### 处理顺序

1. **今天**：P0-1 轮换密钥 → wrangler secret；P0-2 删密码日志
2. **本周**：P0-3 加鉴权；P1-6 补唯一索引；P1-5 md 消毒；P1-9 升 xlsx
3. **迭代**：P2-11 抽公共层；P2-13 导入批量化；P2-12 改 ID 关联

## 长期

- [ ] 实现数据库连接配置加密处理
- [ ] 办理信用卡后，继续跟进站点申请：<https://dashboard.render.com/web/new?onboarding=active>
