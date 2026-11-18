# Cloudflare D1 部署

在 Cloudflare 控制台操作即可，支持 Workers 免费计划。

1. 在 **D1 SQL Database** 新建数据库，在该库的 **Console** 执行 [初始化 SQL](../cloudflare/d1/migrations/0001_archive.sql)。
2. 在 **Workers & Pages** 新建 Worker。通过 **Edit Code** 粘贴 [Worker 源码](../cloudflare/d1/worker.js)，点击 **Deploy**。
3. 在 Worker 的 **Overview → Bindings → Add a binding** 选择 **D1 database**。变量名固定填 `ARCHIVE`，数据库选第 1 步创建的库。
4. 在 **Settings → Variables and Secrets** 添加 **Secret**，名称为 `ARCHIVE_TOKEN`，值用密码管理器生成的随机密码。
5. 打开行迹网页的 **Cloudflare D1** 连接卡片，填写 Worker 根地址和同一串凭证。

**连接时收到 503**　确认 Worker 的 **Bindings** 有名为 `ARCHIVE` 的 D1 绑定，并在该数据库的 **Console** 核对是否存在 `archive_state` 和 `tickets` 两张表。新库缺表时，执行第 1 步的初始化 SQL。

仅连接 GitHub 时，网页使用 GitHub 票库。此时添加 D1 会先用 GitHub 的数据覆盖 D1，再切换到 D1 日常读写。D1 暂时不可用时，仍可查看它的本机缓存。

先用 D1 再绑定 GitHub 时，确认后会自动备份一次。此后通过「立即备份到 GitHub」手动更新。覆盖和备份都包含票据、个人资料、MCP 和两种连接的凭证，写入 GitHub 的凭证会保留在 Git 历史中。手动重置仓库保留设置。

[Cloudflare 的 D1 配置文档](https://developers.cloudflare.com/d1/get-started/) · [Worker 凭证设置](https://developers.cloudflare.com/workers/configuration/secrets/)
