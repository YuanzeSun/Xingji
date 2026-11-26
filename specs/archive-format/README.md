# 共享票库协议

浏览器与 Flutter 共用 `xingji-archive` schema 2；索引使用 `xingji-index` schema 1。字段表见 [fields.json](fields.json)，真实结构示例见 [conformance.json](../fixtures/conformance.json)。

## 日期与来源

四个行程日期字段为 `""` 或 `{ "year": 2026, "dayOfYear": 321 }`。年份与年内天数可分别为 `null`，显示时再换算月日。出发、到达、实际起飞、实际落地分别记录；时刻为当地 `HH:mm`，时区由机场参考数据确定。BCBP 只提供年内天数时不得猜测年份。

`fieldSources` 逐字段记录 `manual`、`barcode`、`ocr`、`railgo` 等来源。条码确定的字段锁定；出发日期只锁定年内天数。`lockedFields` 和 `lookupValues` 用于保留人工编辑的优先级，不在界面显示“人工矫正”。条码原始字节存 Base64，机票展示统一重建 PDF417。

铁路电子发票导入可附带 `railInvoice`，其中只保存 `electronicTicketNumber`（电子客票号）。纸票的 `ticketNumber` 与 `saleCode` 分别保存。

纸质报销凭证与退票费报销凭证可保存 `railShowIssuer: true`，表示票面显示售票站。默认省略此字段，售票站本身仍记录在 `issuer`。

机票可附带 `flightTrack`，包含飞常准查询标识 `flightStr`、查询时间 `queriedAt` 和按段保存的经纬度 `segments`。快照仅匹配本票的航班号、出发日期和起降机场。

`flightStops` 按航班号 `fnum`、出发日期 `date` 和起降机场 `dep`、`arr` 保存票据乘坐区间的计划经停。包含经停次数 `count` 和依行程顺序记录的机场三字码 `airports`。`count: 0` 表示已确认直飞。机场三字码缺失时可只记录次数。

## GitHub 文件

- `archive/2026.json` 等按出发年份分组；年份未知写入 `archive/unknown.json`。
- `archive/index.json` 保存文件 SHA-256、总记录数、重置标识 `generation`、个人资料及飞常准连接设置。
- 网页版与 Flutter 可以同时连接同一个私有仓库和分支。两端使用同一套票据校验与标准化规则，保留另一端写入的票据字段、条码和行程资料。
- Git tree、commit、非强制 ref 更新共同提交一次完整快照。基于上次成功同步的副本进行三方合并。分支已前进时重新读取并合并；同一字段有冲突时须确认取值。
- 删除记录保留清理后的墓碑参与同步；线路和时刻表快照属于记录的一部分。地图打开时不发起线路查询。
- 同步前验证私人仓库、写权限、仓库 ID、提交祖先关系及 `generation`；远端重置不会悄悄把本机旧记录重新上传。

## 对照验证

`node scripts/prepare-flutter-assets.mjs` 从现有模型生成字段、参考数据、示例和跨语言用例。修改协议后运行浏览器测试及 `packages/xingji_core` 的 Dart 测试。用例同时检查日期、1–4 航段 BCBP、去重与字段冲突合并，不能只测试导入导出自身往返。
