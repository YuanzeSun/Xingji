# 航司 logo 库

`assets/airline-logos/` 收录 [Soaring Symbols](https://github.com/soaring-symbols/soaring-symbols) `0.4.1` 的彩色标志和从航司、机场官网补齐的标志。Soaring Symbols 优先用航司官网或品牌资料的原标志，将独立图案裁切、等比居中并优化为 SVG。该库把图标放在 24×24 网格，完整标识放在 64×64 网格。行迹将两种素材都等比归一到透明的 24×24 SVG，保留原图案的颜色和比例。

`src/data/airline-logos.js` 是项目内置副本，按已填写的航司中文名、英文名、别名、IATA 或 ICAO 代码精确匹配。中文别名关联使用已有航司参考库，代码重用产生歧义时不强行匹配；不根据航班号前缀猜测航司。未收录或无法唯一匹配时仍显示航司名称，不展示其他公司的图案。

票头标志和淡色水印共用嵌入票面的 SVG。预览、独立 SVG、PNG 和纪念册离线也可显示。票据只保存航司文字。

补充航司时优先采用官方 SVG。遇到官方只有位图的情况，可用 `scripts/prepare-airline-logo.py`（需要 Pillow 12.1 或以上版本及 VTracer）裁出独立图案，转成透明底矢量。例如 `python scripts/prepare-airline-logo.py logo.png assets/airline-logos/example.svg --name "Example Airlines"`。横排标识可用 `--crop LEFT TOP RIGHT BOTTOM` 取出图形部分。确定原图有白色底时可加 `--white-background`，已知品牌色时可用 `--colors` 收敛位图边缘的杂色。逐个检查成品的形状、配色和透明区域后，把航司名称、代码和来源写入 `catalog.json`。

运行 `node scripts/update-airline-logos.mjs` 重建内置映射。脚本只读取本地文件并检查 SVG 内容。`licenses/airline-logos.json` 记录版本、逐文件来源和摘要。`licenses/SOARING-SYMBOLS-MIT.txt` 保留原目录的许可。航司商标归各权利人所有。
