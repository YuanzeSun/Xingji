# 航司 logo 库

`assets/airline-logos/` 收录 [Soaring Symbols](https://github.com/soaring-symbols/soaring-symbols) 和航司、机场官网的标志。独立图标使用透明的 24×24 SVG，完整标识裁掉外围空白，保留文字组合的原始宽高比。

`src/data/airline-logos.js` 是项目内置副本，按已填写的航司中文名、英文名、别名、IATA 或 ICAO 代码精确匹配。中文别名关联使用已有航司参考库，代码重用产生歧义时不强行匹配；不根据航班号前缀猜测航司。未收录或无法唯一匹配时仍显示航司名称，不展示其他公司的图案。

票头优先使用完整标识，显示高度统一，宽度随比例变化。水印只采用独立图形或航司实际使用的独立字母徽记。两种素材都嵌入票面，预览、独立 SVG、PNG 和纪念册离线也可显示。票据只保存航司文字。

补充航司时优先采用官方 SVG。遇到官方只有位图的情况，可用 `scripts/prepare-airline-logo.py`（需要 Pillow 12.1 或以上版本及 VTracer）裁出独立图案，转成透明底矢量。例如 `python scripts/prepare-airline-logo.py logo.png assets/airline-logos/example.svg --name "Example Airlines"`。横排标识可用 `--crop LEFT TOP RIGHT BOTTOM` 取出图形部分。确定原图有白色底时可加 `--white-background`，已知品牌色时可用 `--colors` 收敛位图边缘的杂色。逐个检查形状、配色和透明区域后，将文件和来源写入 `catalog.json`。只有独立图标时使用 `type: "icon"`，完整标识使用 `type: "logo"`，另有独立图标时登记在 `icon` 下。

运行 `node scripts/update-airline-logos.mjs` 重建内置映射。脚本只读取本地文件并检查 SVG 内容。`licenses/airline-logos.json` 记录版本、逐文件来源和摘要。`licenses/SOARING-SYMBOLS-MIT.txt` 保留原目录的许可。航司商标归各权利人所有。
