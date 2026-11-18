# Flutter 共用工程与平台接入

Flutter 3.50.0 / Dart 3.14.0。与网页版保留在同一仓库，现有 `src/`、浏览器 OCR、连接扩展和 Pages 部署继续使用。Flutter Web 目前用于预览，不替换在线网页版。

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

- 私人票库与示例完全隔离；退出示例回到原入口。示例不出现录入或同步入口。
- 手动录入、条码内容解码、原生识别结果解析均进入同一表单核对。BCBP 确定的字段锁定，未知年份可补填；计划时刻与实际时刻分开记录。
- 票据先保存到本机，再同步到 GitHub。写入期间有进度；失败保留本机修改。同步验证私人仓库、权限、仓库身份、提交关系和重置标识，冲突需选择后提交。
- 连接令牌目前只保留在当前应用会话中。App 可编辑姓名与常用证件，按国内／国际行程预填；个人资料和既有飞常准设置参与三方合并。飞常准查询暂不接入。
- RailGo 查询发生在录入或编辑时，结果和线路快照随票据保存；打开地图不查询 API。铁路与飞机图层互斥规则沿用产品约定。
- 铁路线名称采用与网页版相同的线路目录及几何匹配规则，在录入／刷新时保存名称和多个候选标注点。地图离线读取快照，在当前视野中避让站名并重新选择标注位置；缩放保持文字可读。
- JSON、CSV、行程文字导入先核对后保存；多航段条码可选择导入。票夹支持票面勾选、全选、CSV、PDF 手册、逐张 PNG（多张打包 ZIP）和批量删除。仓库重置保留个人资料、飞常准设置及 Git 历史。
- PNG 票面及 PDF 手册生成已有共用实现。桌面文件保存与浏览器下载可用；iOS / Android 的系统分享和文件导出留待原生接入，各平台文件面板仍需真机验收。

## 平台能力接口

`SystemRecognition` 使用 `dev.yuanzesun.xingji/recognition` 平台通道。缺少原生实现时返回能力不可用，不使用模拟结果填充用户票据，也不引入 Tesseract 到 App。

`capabilities` 返回 `{ "ocr": true, "barcode": true }`；未来模型能力需单独检测，不把系统版本作为唯一判断。

`recognizeImage` 接收 `{ bytes: Uint8List, languages: ["zh-Hans", "en"], barcodes: true }`，同时运行文字识别与条码检测，返回：

```json
{
  "lines": [{"text":"登机口 A101","x":0.1,"y":0.2,"width":0.3,"height":0.05,"confidence":0.95}],
  "barcodes": [{"rawBytes":"TTEuLi4="}]
}
```

坐标以完成方向矫正后的整张图为准，左上为原点，范围 0–1；原始条码字节用 Base64，不能先按 UTF-8 转换后丢失字节。公共层优先使用条码，OCR 只补充其余信息。原生错误通过通道错误返回，取消不得返回伪造的空识别结果。

铁路二维码要保持原样重建，原生提供方还需在对应 `barcodes` 项中给出 `codeData`：`version:1`、`format`、相同的 Base64 `rawBytes`、`symbologyIdentifier`、`gs1`、`eci:[{offset,value}]` 和 `parameters:{symbolVersion,errorCorrectionLevel,mask}`。参数必须来自实际检测，未知值留空，不推测掩码或纠错等级；只能读出字节时可以导入文字，但不能声称已保存可精确重建的原码。机票条码按 BCBP 解码后统一重建为 PDF417。

| 平台 | 等环境准备好后继续 |
| --- | --- |
| iOS / iPadOS | Xcode 签名与真机；Vision OCR / 条码；相机及照片权限；系统分享与 Keychain；确认 iPad 分屏布局和手势 |
| macOS | Xcode 构建与签名；Vision 接入；文件面板、权限及 Keychain；票面导出与触控板验收 |
| Android | 准备 SDK / JDK 与设备后构建；系统识别提供方；相机与文件权限；安全凭证存储、返回手势和系统栏验收 |

Apple Intelligence / Foundation Models 是后续可选的结构化补全提供方，应独立于 OCR。基础识别与保存不能依赖设备支持这些能力。当前没有实现上述平台专属识别、相机、模型或分享扩展；没有安装 Android SDK / JDK。

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

Windows 的动态库位于 `build/windows/x64/runner/Release/quickjs_c_bridge_plugin.dll`。Mac 后续使用同一 Flutter 版本、提交的依赖锁文件和生成资产，不需要转换 Dart 代码。各平台的发布、签名与原生识别尚未验收，不能用 Windows / 浏览器的通过结果替代真机验收。

本轮逐项检查、尚未迁移的界面及 Apple 编译交接见 [Flutter 功能核查](flutter-parity-audit.md)。
