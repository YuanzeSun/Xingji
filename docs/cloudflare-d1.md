# Cloudflare D1 部署

在 Cloudflare 控制台操作即可，支持 Workers 免费计划。

1. 在 **D1 SQL Database** 新建数据库，依次执行 [初始化 SQL](../cloudflare/d1/migrations/0001_archive.sql) 和 [票据结构 SQL](../cloudflare/d1/migrations/0002_ticket_payload.sql)。使用 Wrangler 管理的新库可按迁移编号应用。
2. 在 **Workers & Pages** 新建 Worker。通过 **Edit Code** 粘贴 [Worker 源码](../cloudflare/d1/worker.js)，点击 **Deploy**。
3. 在 Worker 的 **Overview → Bindings → Add a binding** 选择 **D1 database**。变量名固定填 `ARCHIVE`，数据库选第 1 步创建的库。
4. 在 **Settings → Variables and Secrets** 添加 **Secret**，名称为 `ARCHIVE_TOKEN`，值用密码管理器生成的随机密码。
5. 打开行迹网页的 **Cloudflare D1** 连接卡片，填写 Worker 根地址和同一串凭证。

### 已有数据库升级

分页读取使用现有票据主键。已完成 `0002` 迁移的数据库可直接部署 [新版 Worker 源码](../cloudflare/d1/worker.js)。

若数据库只执行过 `0001`，先应用 [0002 票据结构迁移](../cloudflare/d1/migrations/0002_ticket_payload.sql)，再通过 **Edit Code → Deploy** 更新 [Worker 源码](../cloudflare/d1/worker.js)。迁移保留现有票据、数据库身份、重置代次和设置，清除旧关联编号，并在数据库层约束删除标记的结构。字段来源仍可在行迹的「数据迁移」中按需清理。

已用 Wrangler 登记初始化迁移时，执行 `npx wrangler d1 migrations apply <数据库> --remote`。如果之前是在控制台手动运行初始化 SQL，只执行新增文件 `npx wrangler d1 execute <数据库> --remote --file=cloudflare/d1/migrations/0002_ticket_payload.sql`。[Cloudflare Wrangler 命令](https://developers.cloudflare.com/d1/wrangler-commands/)

**连接时收到 503**　确认 Worker 的 **Bindings** 有名为 `ARCHIVE` 的 D1 绑定，并在该数据库的 **Console** 核对是否存在 `archive_state` 和 `tickets` 两张表。新库缺表时，执行第 1 步的初始化 SQL。

绑定第二个服务时，根据票据数量和账号选择以 GitHub 或 D1 的票库为准，再确认覆盖另一边。完成后 D1 负责日常读写，通过「立即备份到 GitHub」手动更新备份。新设备登录任一已绑定的账号时会恢复另一个连接，并从 D1 读取主票库。D1 暂时不可用时，已登录设备仍可查看它的本机缓存。只登录 D1 时，退出会清理本机票库缓存并回到登录页。

迁移包含票据、个人资料、MCP 和两种连接的凭证。写入 GitHub 的凭证会保留在 Git 历史中。绑定后的两个账号一起退出，跨设备登录时仍会恢复关联。「重置仓库」默认保留关联。如需分别使用，勾选「同时解除关联」并选择当前设备要继续使用的票库。两边的票据都会重置，个人资料和 MCP 设置分别保留。

[Cloudflare 的 D1 配置文档](https://developers.cloudflare.com/d1/get-started/) · [Worker 凭证设置](https://developers.cloudflare.com/workers/configuration/secrets/)
