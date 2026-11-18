# Flutter 共用工程与平台接入

Flutter 3.50.0 / Dart 3.14.0。App 在 `app` 分支开发，原网页版在 `main`。网页版和共享改动先提交到 `main`，再合入 `app`。仅影响 Flutter 的改动单独提交到 `app`。

Pages 通过 GitHub Actions 中的 **Publish Xingji Pages** 手动发布。从 `main` 运行，选择 `web` 发布原版，选择 `flutter` 发布 `app` 分支的浏览器预览。两个版本共用同一个地址。

## 工程结构

| 目录 | 内容 |
| --- | --- |
| `apps/flutter/lib` | 自适应票夹、详情、录入、地图、统计、同步与导出 |
| `packages/xingji_core` | 无 Flutter 依赖的票据模型、日期、BCBP、识别结果解析、参考地点、去重、三方合并及 GitHub / RailGo 客户端 |
| `specs/archive-format` | 共用票库格式和字段 |
| `specs/fixtures` | JavaScript 与 Dart 同时执行的对照用例 |
| `design-system/flutter/MASTER.md` | 已确认的收藏册方向、视觉与交互规则 |

## 票面保持原样

`src/tickets.js` 及其模板仍是唯一票面来源。`scripts/prepare-flutter-renderer.mjs` 把原有规则打包为本机绘图运算，Flutter 页面不重新定义排版。App 使用 QuickJS，浏览器预览调用同一份打包脚本；这不是网页容器。

本机字体解析和 SVG 生成运行在常驻工作 isolate 中，避免占用界面线程。示例票面预生成，真实票面按模板加载需要的字体并缓存，不在启动时解析全部字体。

字体保留之前按票样校准的轮廓、度量和字距，输出为矢量字形，避免 Flutter 再次排字造成差异。固定票纸底纹与背景列车按原图在默认导出尺寸预合成，修正叠加透明度；可变文字与条码保持矢量。许可一并放在 `assets/fonts/`。测试核对七类示例的完整原始 SVG，并对兼容图形展开做独立渲染检查。另行导出 Flutter 图片与原浏览器票面检查字体、字距、数字、列车和 CRH；不同绘制器的边缘抗锯齿有轻微区别，不能将模板相同等同于逐像素相同。

## 共用流程

- App 默认打开本机票夹。示例票据与本机票库隔离，退出示例回到本机票夹。示例模式隐藏录入和同步入口。
- 点「＋」选择扫描、上传、手动填写或粘贴。单张票据进入表单核对，多张票据进入批量核对。BCBP 确定的字段锁定，月日在补全年份后显示。计划时刻与实际时刻分开记录。
- 未绑定 GitHub 时直接保存到本机。首次绑定会上传本机票据；两边都有票据时可选择合并、用本机替换云端或用云端替换本机。替换云端会保留 Git 历史和其他文件。
- 网页与 App 可同时连接同一个 GitHub 私有仓库和分支。两端共用同一套存档校验与标准化规则。
- 新绑定使用 `main`。在「同步 → 连接说明」可查看私有仓库和访问令牌的配置步骤。给该仓库的细粒度令牌授予 `Contents: Read and write`，并通过初始提交建立 `main` 分支。
- 绑定后必须在线写入 GitHub，云端确认后才更新本机缓存。离线可查看和导出。会话授权有效时，App 回到前台或定时检查时会拉取云端变化。并发提交会先重新读取并合并不同字段，同一字段冲突时需要选择保留哪一版。
- iOS 用系统钥匙串保存 GitHub 令牌，重启后恢复绑定并核对云端。App 可编辑姓名与常用证件，按国内／国际行程预填；个人资料和既有飞常准设置参与三方合并。iOS 可从「同步 → 飞常准行程」查询已授权的本人历史及未来行程，核对后导入。新输入的飞常准 Key 在查询成功后写入本机钥匙串。
- RailGo 查询发生在录入或编辑时，结果和线路快照随票据保存；打开地图不查询 API。铁路与飞机图层互斥规则沿用产品约定。
- 铁路线名称采用与网页版相同的线路目录及几何匹配规则，在录入／刷新时保存名称和多个候选标注点。地图离线读取快照，在当前视野中避让站名并重新选择标注位置；缩放保持文字可读。
- `xingji-backup.json` 包含票据、个人资料、飞常准设置和可用的 GitHub 凭证。导入时先核对并保存票据与设置，再选择是否绑定尚未设置的 GitHub 连接。CSV 也支持导入。GitHub 同步使用独立的 `archive/index.json` 和年度分片。长按票据进入批量选择，再点按票据切换勾选。票夹支持全选、PDF 手册、逐张 PNG（多张打包 ZIP）和批量删除。旅行手册只在票夹选中票据后出现。GitHub 仓库可单独授权重置，并保留个人资料、飞常准设置及 Git 历史。
- PNG 票面及 PDF 手册生成已有共用实现。桌面文件保存与浏览器下载可用。iOS 使用系统分享菜单导出，Android 仍等原生接入。

## 平台能力接口

`SystemRecognition` 使用 `dev.yuanzesun.xingji/recognition` 平台通道。iOS 使用 Apple Vision 识别文字和条码，从文稿扫描器、系统照片选择器或文件导入。缺少原生实现的平台返回能力不可用。

`capabilities` 返回 `ocr`、`barcode`、`camera`、`liveBoarding` 和 `appleIntelligence`。端侧模型文字提取需要 iOS 26 或更新版本，图文提取需要 iOS 27 或更新版本。两者都会检查系统模型的可用状态。

`recognizeImage` 接收 `{ bytes: Uint8List, languages: ["zh-Hans", "en"], barcodes: true }`，同时运行文字识别与条码检测，返回：

```json
{
  "lines": [{"text":"登机口 A101","x":0.1,"y":0.2,"width":0.3,"height":0.05,"confidence":0.95}],
  "barcodes": [{"rawBytes":"TTEuLi4="}]
}
```

坐标以完成方向矫正后的整张图为准，左上为原点，范围 0–1。原始条码字节以 Base64 传输。图片录入将票面与 OCR 文字提示一起交给端侧模型，合并时以条码字段为准。原生错误通过通道返回，取消返回空值。

铁路二维码要保持原样重建，原生提供方还需在对应 `barcodes` 项中给出 `codeData`：`version:1`、`format`、相同的 Base64 `rawBytes`、`symbologyIdentifier`、`gs1`、`eci:[{offset,value}]` 和 `parameters:{symbolVersion,errorCorrectionLevel,mask}`。参数必须来自实际检测，未知值留空，不推测掩码或纠错等级；只能读出字节时可以导入文字，但不能声称已保存可精确重建的原码。机票条码按 BCBP 解码后统一重建为 PDF417。

| 平台 | 接入状态 |
| --- | --- |
| iOS / iPadOS | 底栏使用系统标签栏，录入入口和表单下拉项使用 UIKit 菜单。iOS 26 起底栏采用系统 Liquid Glass。月日、日期和时刻使用紧凑的系统滚轮。年份和 GitHub 凭据使用 UIKit 输入框，其他票据字段使用 Cupertino 控件。iPad 分屏布局留待下一阶段。 |
| macOS | Xcode 构建与签名；Vision 接入；文件面板、权限及 Keychain；票面导出与触控板验收 |
| Android | 准备 SDK / JDK 与设备后构建；系统识别提供方；相机与文件权限；安全凭证存储、返回手势和系统栏验收 |

图片录入使用 iOS 27 Apple Intelligence 的端侧多模态接口。Vision 提供条码及文字提示。识别到的 BCBP 字段先锁定，随后用票面图片和文字提示补全其余字段，整次识别结束后一次性返回。可从「＋ → 扫描」实时检测条码和拍照，从「＋ → 粘贴」读取剪贴板上的文字或图片。普通文字使用端侧模型提取字段。PDF 文字层和 .pkpass 按结构化来源读取。

## iOS 地图与文件导入

行程总图与票据详情可在「原生地图」和「简笔地图」之间切换，两种模式都可全屏。原生地图使用 Apple MapKit 普通底图，叠加已保存的线路名称，不额外绘制站点图钉。简笔地图沿用本地绘制和离线边界。线路优先使用乘坐区间快照，没有记录时用虚线标明示意路线。

- 「同步 → 导入票库」可选择图片、PDF、`.pkpass`、JSON 或 CSV。在 iOS 上可以通过系统「打开方式」把 PDF 和 `.pkpass` 送入分享收件箱。
- 「分享到行迹」由 `ShareImport` 扩展接收票据。图片、PDF 和钱包票券先加入「同步 → 自动导入 → 分享收件箱」，入库成功后移除待处理文件。PDF 优先读取文字层，对无文字页运行 Vision，也会检测登机牌条码。每份 PDF 最多 24 页、40 MB。
- `.pkpass` 只读文件内的 `pass.json`，不解压资源到磁盘。标准 BCBP 条码使用现有解码器，其他票券按显式航班字段导入。不使用 `relevantDate` 推测起飞时间，不对导入文件重新签名。
- 真机分享扩展要求 Runner 和 ShareImport 的签名包含同一个 App Group。签名账户支持此能力时，在两个目标配置同一团队和 App Group，本机可建立 `apps/flutter/ios/Flutter/LocalShare.xcconfig`，设置 `XINGJI_APP_GROUP` 和 `CODE_SIGN_ENTITLEMENTS[sdk=iphoneos*] = SharedImport/ShareGroup.entitlements`。没有此签名能力时，可以把文件保存到「文件」后在行迹内选择导入。也可以新建快捷指令，在详情开启「在共享表单中显示」并接收文件，添加行迹的「收集票据文件」操作并传入「快捷指令输入」。钱包分享时选取该快捷指令，之后到行迹的分享收件箱核对。
- 图片与文本识别结果在录入表单中核对，PDF 中的多张票据可批量核对。缺失或不确定的字段留空。

## iPhone 上导入行程短信

1. 打开「快捷指令 → 自动化」，创建「信息」个人自动化。按你收到的短信设置发件人或「信息包含」过滤条件，例如铁路 12306 和订票服务的出票通知。
2. 在自动化中添加行迹的「导入行程短信」操作，将触发信息的正文传给「短信正文」。如系统提供「立即运行」选项，选择该项。
3. 收到匹配的信息后，行迹保存待导入正文。打开或回到行迹时，符合单一行程、确认出票、日期和地点明确等条件的票据会自动入库。其他通知可在「同步 → 自动导入 → 行程短信」核对或忽略。绑定的云端票库暂时只读时，待处理短信会保留在本机。

已有短信可以复制正文，在「＋ → 粘贴」识别。飞常准查询需要个人 MCP Key 和账户的行程授权。接口返回的结构如有变化，可在 App 内核对原始返回。

## 开发与检查

根目录已有生成的数据、字体与绘图脚本，普通构建无需重复生成。更新参考数据或票面规则时：

```sh
node scripts/prepare-flutter-assets.mjs
node scripts/prepare-flutter-renderer.mjs
# 仅字体发生变化时；开发机需要 fonttools[woff]
python scripts/prepare-flutter-fonts.py
node scripts/prepare-flutter-brand.mjs
```

```sh
node --test tests/*.test.js
node scripts/build.mjs
cd packages/xingji_core
dart pub get
dart analyze
dart test
cd ../../apps/flutter
flutter pub get
flutter analyze
flutter test
flutter build web --release
flutter build windows --release
```

原生绘图引擎对照测试需先构建当前桌面平台，然后设置 `LIBQUICKJSC_TEST_PATH` 指向构建所得 QuickJS 动态库再运行 `flutter test test/native_renderer_test.dart`。没有动态库的普通 Widget 检查会明确跳过这一项；其余检查不依赖原生识别提供方。

Windows 的动态库位于 `build/windows/x64/runner/Release/quickjs_c_bridge_plugin.dll`。iOS 工程已使用 Xcode 27.2 构建，并在 iPhone 上安装运行。真机自测可在 `apps/flutter` 中运行 `flutter build ios --profile`，构建时选择本机签名团队。App Groups 系统分享和端侧模型识别需在各自满足签名与系统资格的真机上验收。

初期共用界面的核查和 Mac 编译交接见 [Flutter 功能核查](flutter-parity-audit.md)。
