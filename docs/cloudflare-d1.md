# 网页版 Cloudflare D1

部署自己的 Cloudflare Worker 和 D1 数据库后，在行迹网页填写 Worker 地址和访问凭证。使用 Workers 免费计划即可开始。

## 部署

1. 安装 Node.js，进入项目的 `cloudflare/d1` 目录，运行 `npx wrangler login` 登录 Cloudflare。
2. 运行 `npx wrangler d1 create xingji-archive --update-config=false`，将数据库 ID 写入 `wrangler.jsonc` 的 `database_id`。为行迹单独创建一个数据库。若自行托管网页，将网页的源地址（例如 `https://archive.example.com`，不含路径）填入 `ALLOWED_ORIGINS`。多个地址用逗号分隔。
3. 运行 `npx wrangler d1 migrations apply xingji-archive --remote`，然后运行 `npx wrangler deploy`。
4. 运行 `npx wrangler secret put ARCHIVE_TOKEN`，粘贴随机生成的访问凭证。可以用 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成。下次更新 Worker 时继续使用同一个 D1 数据库。
5. 在网页「Cloudflare D1」卡片中填写部署结果里的 Worker 根地址和 `ARCHIVE_TOKEN`。Cloudflare 账户 API Token 用于部署授权，网页只需要 Worker 的访问凭证。

## 连接和备份

| 当前主票库 | 下一步 | 结果 |
| --- | --- | --- |
| 无 | 连接 D1 | 使用 D1 中现有票据，新数据库从空票库开始 |
| GitHub | 在当前浏览器首次连接 D1 | 确认后用 GitHub 中现有的行迹票据和设置整体替换 D1，切换为 D1 日常同步 |
| D1 | 在当前浏览器首次绑定 GitHub | 确认后清空 GitHub 中当前的行迹票据和设置，保留仓库其他文件与 Git 历史 |
| D1 | 立即备份到 GitHub | 确认后用 D1 中当前的票据和设置覆盖 GitHub 中的行迹数据 |

在新设备使用已有 D1 票库，直接连接 D1 即可。更新同一连接的凭证会保留已绑定的数据。D1 暂时不可用时，网页显示本地只读缓存。Flutter 继续使用其现有的本机及 GitHub 模式。

免费额度按 Cloudflare 账户计算，每日 500 万行读取与 10 万行写入，单个 D1 数据库最多 500 MB。额度用尽后可等待下次重置。 [D1 免费额度](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 容量限制](https://developers.cloudflare.com/d1/platform/limits/)
