# 航司 logo 库

素材统一取自 [Soaring Symbols](https://github.com/soaring-symbols/soaring-symbols) `0.4.1`，仅复制选用的 153 个 SVG 文件及必要映射、许可到本项目的 `assets/airline-logos/`，不引入原仓库、子模块或 npm 依赖。优先采用统一 24×24 网格的彩色图标，缺少图标时使用同库的 logo。没有从用户票面照片中提取图案，也没有逐家官网收集。

`src/data/airline-logos.js` 是项目内置副本，按已填写的航司中文名、英文名、别名、IATA 或 ICAO 代码精确匹配。中文别名关联使用已有航司参考库，代码重用产生歧义时不强行匹配；不根据航班号前缀猜测航司。未收录或无法唯一匹配时仍显示航司名称，不展示其他公司的图案。

标识作为 SVG 数据嵌入票面，预览、独立 SVG、PNG 和纪念册均使用相同素材，离线时无需请求第三方 logo 服务。票据仅保存航司文字，不保存上传图片、远程 logo URL 或每票重复的 logo 数据。

维护本地 SVG 文件和精简目录后运行 `node scripts/update-airline-logos.mjs` 可重建映射。脚本只读取本项目内的文件，并拒绝带脚本或外部资源的 SVG。`licenses/airline-logos.json` 记录来源、版本、逐文件摘要；`licenses/SOARING-SYMBOLS-MIT.txt` 保留原目录的许可。航司商标本身归各权利人所有，不属于库的 MIT 或本项目许可证范围。
