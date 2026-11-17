# 机型识别

机型字段可手动填写，也可从文字、截图扫描、CSV、航空 JSON 或航班查询结果导入。名称、常见缩写及明确对应的设备代码在本地统一处理，无额外网络查询或接口额度消耗。未知的手填型号保留原文。

覆盖空客、波音，以及 DHC-6/7/8、ATR 42/72、ERJ、E-Jet/E2、CRJ、C909/C919、Saab、Fokker、Dornier、Cessna 208、L-410、SSJ100、新舟60、运12、BAe/Avro、麦道、伊尔、图波列夫和安东诺夫等系列。

例如 `Dash 8` 统一为 `DHC-8`，`Q400`、`DH8D` 统一为 `DHC-8-400`，`AT76` 为 `ATR 72-600`，`E295` 为 `E195-E2`。统计采用同一名称，避免不同写法重复计数。扫描同时排除机型被误读为航班号的情况。

只给出 `DHC-8` 不会补成 `DHC-8-400`；明确的 `DHC-8-402`、`737-85C(WL)` 等细分型号继续保留。共享多个商业型号的 `CRJ7`、`CRJ9`、`E135` 保留代码，不能凭此选定 550/700、705/900 或 135/140。裸 `B737` 继续按 737 系列处理。纯数字设备代码只在明确的机型字段中解释，避免将票价当作机型。

人工核对的参考来源（2026-11-17）：

- [FAA JO 7360.1J Aircraft Type Designators](https://www.faa.gov/documentLibrary/media/Order/2024-04-29_FAA_Order_JO_7360.1J_Aircraft_Type_Designators--post.pdf)：型号及 ICAO 代码；[FAA Aircraft Characteristics](https://www.faa.gov/air_traffic/publications/media/aircraft_characteristics.pdf) 补充 ATR 系列代码。
- [加拿大交通部机型培训目录](https://tc.canada.ca/en/aviation/licensing-aircraft-maintenance-engineers-ames/approved-aircraft-type-maintenance-training)：DHC-8 系列、Q400 和细分型号。
- [ATR 产品系列](https://www.atr-aircraft.com/regional-mobility/regional-aircraft/)与[Embraer E195-E2](https://www.embraer.com/e-jets-e2/e195e2/en)：制造商机型名称。
- [中国商飞 C909 命名公告](https://english.comac.cc/news/latest/202411/20/t20241120_7396558.shtml)：ARJ21 商业名称为 C909。
- [OpenFlights 机型表](https://github.com/jpatokal/openflights/blob/master/data/planes.dat)：交叉核对常见订座系统代码。未引入完整数据库、仓库或运行时依赖。

这些是机型名称参考，不能用来证明某航班在某一天实际由哪一架飞机执飞。航班补全仍须按日期及航段匹配，机尾号单独保存。
