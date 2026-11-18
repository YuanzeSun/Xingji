# Third-party assets and libraries

- **Noto Serif SC / Noto Sans SC** — The Noto Project Authors, SIL Open Font License 1.1. Locally instantiated static font files are bundled in `public/fonts`. Copyright and license text are preserved in `public/fonts/OFL.txt` and `public/fonts/OFL-NotoSansSC.txt`.
  - https://github.com/google/fonts/tree/main/ofl/notoserifsc
  - https://github.com/google/fonts/tree/main/ofl/notosanssc
- **Xingji Roman** — a renamed Latin subset derived from Noto Serif SC under the same SIL OFL 1.1. Copyright and license records are preserved in the font and `public/fonts/OFL.txt`.
- **Xingji Rail Fallback** — renamed subset of the bundled Noto Serif SC for uncommon station-name characters missing from Fandol. Generated with `scripts/prepare-rail-fallback.py`; original copyright records and the same SIL OFL 1.1 notice in `public/fonts/OFL.txt` are retained.
- **FandolFang / FandolKai / FandolSong Bold** — Clerk Ma and Jie Su (Fandol team), GPL with the font embedding exception. Local WOFF2 conversions preserve the outlines and attribution; license and upstream description are in `public/fonts/Fandol-COPYING.txt` and `Fandol-README.txt`. Original font sources and releases: https://ctan.org/pkg/fandol and https://mirrors.ibiblio.org/CTAN/fonts/fandol/ . These font licenses do not change the application license.
- **Roboto Condensed / Roboto Mono** — Google Fonts contributors, SIL OFL 1.1. Instantiated regular WOFF2 files with notices in `OFL-RobotoCondensed.txt` and `OFL-RobotoMono.txt`.
  - https://github.com/google/fonts/tree/main/ofl/robotocondensed
  - https://github.com/google/fonts/tree/main/ofl/robotomono
- **Tesseract.js 6 / tesseract.js-core 6** — Apache-2.0. The browser worker and WebAssembly core are copied from installed packages during build.
  - https://github.com/naptha/tesseract.js
  - https://github.com/naptha/tesseract.js-core
- **tessdata_fast** — Apache-2.0. Simplified Chinese and English recognition models are bundled as gzip files in `public/ocr`.
  - https://github.com/tesseract-ocr/tessdata_fast
- **PDF.js / pdfjs-dist** — Apache-2.0. Bundled parser, worker, CMaps and standard fonts; their package notices and licenses are preserved in the built vendor assets.
  - https://github.com/mozilla/pdf.js
- **esbuild**, **jsdom**, **fake-indexeddb**, **resvg-js** — development and verification dependencies; see their package licenses in the lockfile-resolved packages.

Ticket layouts and icons in this application are independently implemented SVG. The v2 rail geometry was calibrated against the 12306 specimens published 2015-06-24: https://www.12306.cn/mormhweb/zxdt/201506/t20150624_3160.html . Reference photographs are not distributed as application assets. All sample journeys, serials and masked passenger information are fictional. Railway backgrounds remain vector reconstructions, not recovered official ticket stock. Barcode content is read only from supplied originals; archives store decoded bytes and encoding parameters only; vector barcodes are regenerated on display and verified by decoding.
# City reference data

Airport continent membership in `src/data/airport-geography.js` is derived from the `continent` field in the same OurAirports Public Domain airport snapshot. Original-source SHA-256 and URL are embedded with the generated data. Geographic aggregation and its treatment of the bundled Lao railway stations are documented in [docs/statistics.md](docs/statistics.md).

The city lookup includes factual station fields extracted from the public [12306 station table](https://kyfw.12306.cn/otn/resources/js/framework/station_name.js), and IATA/municipality/country/region/name fields from [OurAirports](https://ourairports.com/data/). OurAirports releases its data to the [Public Domain](https://ourairports.com/about.html). Source URLs, snapshot dates and record counts are included in `src/data/location-reference.js`. No LuluTong software code or proprietary timetable database is included.

# Journey map reference data

- **GeoNames** — city and administrative reference coordinates, © GeoNames contributors, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source: [GeoNames](https://www.geonames.org/), [CN and cities500 downloads and field documentation](https://download.geonames.org/export/dump/). The bundled derivative selects relevant city or administrative-seat coordinates and GeoNames IDs, removes ambiguous matches and retains source coordinate precision.
- **OurAirports** — selected IATA airport coordinates from the same Public Domain database listed above, retaining source coordinate precision.
- **Natural Earth** — [1:50m Land](https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/), [1:50m Admin 0 Boundary Lines](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-boundary-lines/), and [1:10m Admin 1 Boundary Lines](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/), [Public Domain](https://www.naturalearthdata.com/about/terms-of-use/). Made with Natural Earth. The bundled derivative projects land polygons, country boundaries using the Natural Earth CN viewpoint (including Chinese claim boundaries from the 1:10m disputed-areas dataset, showing the China viewpoint without separate disputed/control lines) and selected Chinese provincial boundaries into SVG paths while retaining all source vertices.

Snapshot dates, source URLs and original-file hashes are preserved in `src/data/map-reference.js`. No online map service is embedded.

Localized airport aliases in `src/data/airport-labels.js` are derived from Wikidata structured data (CC0-1.0), matched to OurAirports by IATA code, ICAO where available, and coordinates (or exact English name when coordinates are absent). Mainland airport names are checked against the CAAC transport-airport list. Query, source hashes and snapshot date are preserved with the generated data. OpenCC Python (Apache-2.0) is used only during reference generation to add simplified Chinese variants; no converter runs in the application.
- https://www.wikidata.org/wiki/Wikidata:Licensing
- https://www.caac.gov.cn/GYMH/MHGK/MYJC/
- https://github.com/yichen0831/opencc-python

- **Xingji Ticket Arabic** — renamed Arabic subset of Noto Sans Arabic, SIL OFL 1.1. Used as an embedded fallback for international airport names. Original copyright, source and font hash are retained in `public/fonts/OFL-NotoSansArabic.txt`. Generated with `scripts/prepare-arabic-font.py`; contextual shaping features are preserved.
  - https://fonts.google.com/noto/specimen/Noto+Sans+Arabic

The demo code records in `src/demo-code.js` and `src/demo-boarding-code.js` contain fictional payloads and no passenger data or valid travel credentials.

- **zxing-wasm / ZXing-C++** — MIT / Apache-2.0. Used locally to decode and verify ticket barcodes. The decoder WebAssembly and package license are bundled in vendor assets.
  - https://github.com/Sec-ant/zxing-wasm
  - https://github.com/zxing-cpp/zxing-cpp

- **bwip-js / BWIPP** — MIT. Barcode encoding runs locally to render vectors from saved payloads and encoding parameters. Its license is bundled in `vendor/BWIP-JS-LICENSE.txt`.
  - https://github.com/metafloor/bwip-js
  - https://github.com/bwipp/postscriptbarcode

- **Xingji Ticket OCR** — renamed ASCII subset of Matthew Skala's OCR B (2021), derived from Norbert Schwarz's OCR-B, with calibrated side bearings and punctuation spacing. Schwarz permits unrestricted use, modification and distribution; Skala makes no additional copyright claim. Attribution, source URL, original font hash and permission notice are preserved in `public/fonts/OCRB-LICENSE.txt`.
  - https://tsukurimashou.org/ocr.php.en

- **Xingji Date OCR** — modified numeral subset of Matthew Skala's sharp OCR B, derived from Norbert Schwarz's OCR-B. Cap height and side bearings are calibrated for railway departure dates. The source and permission notice are preserved in `public/fonts/OCRB-LICENSE.txt`; `scripts/prepare-date-font.py` rebuilds this subset.
- **Xingji Date Song** — renamed subset of the bundled Noto Serif SC for railway departure date labels. SIL OFL 1.1; original copyright records are retained in the font and the existing Noto OFL notice.

- **geo-tz** — MIT; used only when generating the bundled airport time-zone lookup. [Timezone Boundary Builder](https://github.com/evansiroky/timezone-boundary-builder) data is ODbL 1.0, derived from [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright). The derived lookup in `src/data/airport-timezones.js` is available under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Mainland airports use the civil aviation time zone Asia/Shanghai.

- **Airline reference** — Wikidata structured data (CC0-1.0), selected by IATA airline designator P229 with ICAO P230, Chinese/English names and Chinese aliases. Generated by `scripts/update-airlines.mjs`; source date and hash are in `src/data/airline-reference.js`.

## RailGo 在线线路服务

现行铁路轨迹由 [RailGo 数据服务](https://api.railgo.dev/)在录入或编辑时按需提供，行程轨迹与全程上下文随票据保存至个人票库，地图直接读取快照。该服务仅允许非商业调用，并要求标注来源；商业使用前须另行取得服务方许可。本项目自有源码采用 NCMF 1.0，第三方材料遵循各自许可。

铁路线名称匹配使用 [fog.vicc.wang 的铁路线路图](https://fog.vicc.wang/rails)提供的线路目录和 GeoJSON，与所乘轨迹进行几何比对；只在票据快照中保存匹配名称及标注点，打开地图时不请求该服务。
