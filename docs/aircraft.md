# 机型识别

行迹随版本提供本地机型表。登机牌保留具体型号，统计可按机型或系列汇总。例如 `737-8Q8`、`B738` 和机型字段里的 `738` 都计入 `737-800`。`737-8` 和 `737-8-200` 计入 `737 MAX 8`。

FAA 的公开表提供常见国际机型代码，ICAO 在线目录用于核对收录差异。具体型号和异名按以下来源补充。

波音 737、747、757、767 和 777 的客户型号可根据已收录的系列与客户代号推断统计归属，票面保留具体型号和配置后缀。737 MAX 单独归类。型号末尾的字母写在括号内外均可匹配已知型号，例如 `319-153（N）` 和 `A319-153N` 都归入 A319neo。A330-200 和 A330-300 的已知基础型号也支持 `E`、`X` 后缀。规则归类表示可确定统计系列，单架飞机的具体配置以登记和运行资料为准。

| 数据 | 来源 |
| --- | --- |
| 飞行计划代码和共享代码 | [FAA JO 7360.1K](https://www.faa.gov/documentLibrary/media/Order/FAA_Order_JO_7360.1K_Aircraft_Type_Designators.pdf) · [ICAO Doc 8643](https://www.icao.int/operational-safety/doc-8643-aircraft-type-designators/search) · [FAA Aircraft Characteristics](https://www.faa.gov/air_traffic/publications/media/aircraft_characteristics.pdf) |
| 波音客户型号和注册型号 | [FAA 加拿大 RVSM 登记](https://www.faa.gov/sites/faa.gov/files/2026-02/NAARMO_Canada_RVSM_Approvals.pdf) · [FAA 美国航司机型登记](https://www.faa.gov/sites/faa.gov/files/2023-08/NAARMO_US_Commercial_RVSM_Approvals_Part_121_Section_3.pdf) · [FAA 机型登记](https://registry.faa.gov/aircraftinquiry/Search/MakeModelInquiry) · [FAA SAGE 机型对照](https://www.faa.gov/sites/faa.gov/files/about/office_org/headquarters_offices/apl/FAA-EE-2005-01_SAGE-Technical-Manual.pdf) · [波音 737 MAX 系列](https://www.boeing.com/commercial/737max) · [波音 737-800BCF](https://services.boeing.com/modifications/converted-freighters/737-800-converted-freighter) |
| 客户型号码与配置后缀 | [FAA 机型命名研究（第 3 节）](https://rosap.ntl.bts.gov/view/dot/58291/dot_58291_DS1.pdf) · [澳大利亚 CASA 737 型号认可](https://www.casa.gov.au/sites/default/files/2022-06/type-acceptance-certificate-a108-32-the-boeing-company.pdf) · [阿联酋 GCAA 型号认可](https://www.gcaa.gov.ae/en/epublication/OpenData/GCAAOpenData_DND/UAE%20Type%20Accepted%20Aircraft%20Models.pdf) · [英国 AAIB A330-323X 记录](https://www.gov.uk/aaib-reports/airbus-a330-323x-n270ay-29-may-2008) · [巴黎戴高乐机场 A330 配置记录](https://www.ecologie.gouv.fr/sites/default/files/publications/Rapport_presentation_condition_indicateur_sonore_IGMP_2019.pdf) |
| 空客细分型号 | [EASA A318/A319/A320/A321 型号合格证](https://www.easa.europa.eu/en/downloads/16507/en) · [EASA A330 型号合格证](https://www.easa.europa.eu/en/downloads/7518/en) · [空客 A321XLR](https://www.aircraft.airbus.com/en/aircraft/a320-family/a321xlr) |
| 支线机型和商飞型号 | [加拿大交通部培训机型表](https://tc.canada.ca/en/aviation/licensing-aircraft-maintenance-engineers-ames/approved-aircraft-type-maintenance-training) · [ATR 产品系列](https://www.atr-aircraft.com/regional-mobility/regional-aircraft/) · [EASA ATR 72 型号资料](https://www.easa.europa.eu/en/downloads/7358/en) · [Embraer E-Jets E2 型号对照](https://www.embraer.com/media/vmsjxvk5/e-jets-e2_apm_e-jetse2.pdf) · [商飞 C909 命名公告](https://english.comac.cc/news/latest/202411/20/t20241120_7396558.shtml) |
| 订座和航司布局代码 | [OpenFlights 机型表](https://openflights.org/data#plane) · [东航旅客须知](https://eb.ceair.com/activity/travellernotice/app/index.html) · [南航飞机布局](https://www.csair.com/hk/zh/tourguide/flight_service/cabin_layout/boyin/) |

手填的 `B737` 只确认到系列。`ICAO B737` 可确认到 `737-700`。`南航布局 73Q` 可确认到 `737-800`。显式标注 `ICAO` 时只接受已核实的飞行计划代码。共享代码如 `B739` 和 `CRJ7` 只确认候选范围。飞常准字段能互相印证时采用具体写法。具体写法有出入但归类一致时，填入能确认的机型。出现机型冲突时，表单保留已填的值并提示核对。
