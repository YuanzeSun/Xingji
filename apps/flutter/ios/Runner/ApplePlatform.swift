import Flutter
import PhotosUI
import Security
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import VisionKit

@MainActor
final class ApplePlatform: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate, PHPickerViewControllerDelegate {
  private var pickerResult: FlutterResult?
  private var closingBoardingScanner = false

  func install(on messenger: FlutterBinaryMessenger) {
    AppleRecognition.checkModelAvailability()
    FlutterMethodChannel(name: "dev.yuanzesun.xingji/recognition", binaryMessenger: messenger)
      .setMethodCallHandler { [weak self] call, reply in self?.recognition(call, reply) }
    FlutterMethodChannel(name: "dev.yuanzesun.xingji/apple", binaryMessenger: messenger)
      .setMethodCallHandler { [weak self] call, reply in self?.handle(call, reply) }
  }

  private func recognition(_ call: FlutterMethodCall, _ reply: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any] ?? [:]
    switch call.method {
    case "capabilities":
      reply(["ocr": true, "barcode": true, "camera": UIImagePickerController.isSourceTypeAvailable(.camera),
             "appleIntelligence": AppleRecognition.modelAvailable,
             "appleIntelligenceImage": AppleRecognition.imageModelAvailable])
    case "recognizeImage":
      guard let image = args["bytes"] as? FlutterStandardTypedData else {
        reply(FlutterError(code: "missing_image", message: "没有收到票据图片。", details: nil))
        return
      }
      AppleRecognition.recognize(image.data, languages: args["languages"] as? [String] ?? [],
                                 barcodes: args["barcodes"] as? Bool ?? true,
                                 readText: args["readText"] as? Bool ?? true,
                                 flight: args["flight"] as? Bool ?? false, result: reply)
    case "recognizePDF":
      guard let file = args["bytes"] as? FlutterStandardTypedData else {
        reply(FlutterError(code: "missing_pdf", message: "没有收到 PDF 文件。", details: nil))
        return
      }
      AppleRecognition.recognizePDF(file.data, result: reply)
    case "extractTicketImage":
      guard let image = args["bytes"] as? FlutterStandardTypedData else {
        reply(FlutterError(code: "missing_image", message: "没有收到票据图片。", details: nil))
        return
      }
      AppleRecognition.extractImage(image.data, text: args["text"] as? String ?? "", result: reply)
    case "extractTicketText":
      AppleRecognition.extractText(args["text"] as? String ?? "", result: reply)
    default:
      reply(FlutterMethodNotImplemented)
    }
  }

  private func handle(_ call: FlutterMethodCall, _ reply: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any] ?? [:]
    do {
      switch call.method {
      case "readCredential", "writeCredential", "deleteCredential":
        guard let key = args["key"] as? String, !key.isEmpty, key.utf8.count <= 512 else {
          reply(FlutterError(code: "credential_key", message: "凭据标识无效。", details: nil))
          return
        }
        if call.method == "readCredential" {
          reply(try AppleKeychain.read(key))
        } else if call.method == "writeCredential", let secret = args["value"] as? String, !secret.isEmpty {
          try AppleKeychain.write(secret, to: key)
          reply(nil)
        } else if call.method == "deleteCredential" {
          try AppleKeychain.remove(key)
          reply(nil)
        } else {
          reply(FlutterError(code: "credential_value", message: "凭据不能为空。", details: nil))
        }
      case "directShareAvailable":
        reply(SharedTicketInbox.groupRoot != nil)
      case "sharedTicketFiles":
        reply(try SharedTicketInbox.entries().map(\.summary))
      case "sharedTicketData", "removeSharedTicket":
        guard let key = args["id"] as? String, let id = UUID(uuidString: key) else {
          reply(FlutterError(code: "missing_ticket", message: "待导入文件不存在。", details: nil))
          return
        }
        if call.method == "removeSharedTicket" {
          try SharedTicketInbox.remove(id)
          reply(nil)
        } else {
          reply(try SharedTicketInbox.data(for: id).map { FlutterStandardTypedData(bytes: $0) })
        }
      case "travelMessages":
        reply(try TravelMessageInbox.entries().map { ["id": $0.id, "text": $0.text, "receivedAt": $0.receivedAt] })
      case "acknowledgeTravelMessage":
        if let id = args["id"] as? String { try TravelMessageInbox.acknowledge(id) }
        reply(nil)
      case "chooseUploadSource":
        presentUploadSource(reply)
      case "openGitHubSetup":
        guard let address = args["url"] as? String, let url = URL(string: address),
              url.scheme == "https", url.host == "github.com" else {
          reply(false)
          return
        }
        UIApplication.shared.open(url) { reply($0) }
      case "pickPhoto", "captureTicketPhoto":
        presentPicker(camera: call.method == "captureTicketPhoto", reply: reply)
      case "scanBoardingCode":
        if #available(iOS 16.0, *),
           DataScannerViewController.isSupported, DataScannerViewController.isAvailable {
          presentBoardingScanner(reply)
        } else {
          reply(FlutterError(code: "scanner_unavailable", message: "当前无法实时扫码，可以上传条码图片。", details: nil))
        }
      case "pasteTicket":
        let clipboard = UIPasteboard.general
        if clipboard.hasStrings, let text = clipboard.string,
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          reply(["text": text])
        } else if clipboard.hasImages, let bytes = clipboard.image?.jpegData(compressionQuality: 0.95) {
          reply(["image": FlutterStandardTypedData(bytes: bytes)])
        } else {
          reply(nil)
        }
      case "shareFile":
        try shareFile(args, reply: reply)
      case "pickDate":
        presentDatePicker(args, reply: reply)
      case "pickMonthDay":
        presentMonthDay(args, reply: reply)
      case "pickTime":
        presentTimePicker(args, reply: reply)
      default:
        reply(FlutterMethodNotImplemented)
      }
    } catch {
      reply(FlutterError(code: "apple_platform", message: error.localizedDescription, details: nil))
    }
  }

  private var presenter: UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    guard let scene = scenes.first(where: { $0.activationState == .foregroundActive })
            ?? scenes.first(where: { $0.activationState == .foregroundInactive }),
          var controller = scene.windows.first(where: \.isKeyWindow)?.rootViewController
    else { return nil }
    while let shown = controller.presentedViewController { controller = shown }
    return controller
  }

  private func presentUploadSource(_ reply: @escaping FlutterResult) {
    guard let presenter else {
      reply(FlutterError(code: "picker_unavailable", message: "暂时无法打开扫描选项。", details: nil))
      return
    }
    let sheet = UploadSourceSheet { [weak presenter] source in
      presenter?.dismiss(animated: true) { reply(source) }
    }
    let host = UIHostingController(rootView: sheet)
    host.title = "上传票据"
    host.navigationItem.leftBarButtonItem = UIBarButtonItem(
      systemItem: .cancel,
      primaryAction: UIAction { [weak presenter] _ in
        presenter?.dismiss(animated: true) { reply(nil) }
      }
    )
    let navigation = UINavigationController(rootViewController: host)
    configureSheet(navigation, height: 196)
    presenter.present(navigation, animated: true)
  }

  private func configureSheet(
    _ navigation: UINavigationController, height: CGFloat, allowsDismissal: Bool = false
  ) {
    if #available(iOS 27.0, *), let controller = navigation.topViewController {
      // Keep dismiss and confirmation actions visible while the sheet scrolls.
      var minimization = controller.navigationItem.navigationBarMinimization
      minimization.minimizationBehavior = .never
      controller.navigationItem.navigationBarMinimization = minimization
    }
    navigation.modalPresentationStyle = .pageSheet
    navigation.isModalInPresentation = !allowsDismissal
    if let sheet = navigation.sheetPresentationController {
      if #available(iOS 16.0, *) {
        sheet.detents = [.custom { min(height, $0.maximumDetentValue) }]
      } else {
        sheet.detents = [.medium()]
      }
      sheet.prefersScrollingExpandsWhenScrolledToEdge = false
    }
  }

  private func presentPicker(camera: Bool, reply: @escaping FlutterResult) {
    guard pickerResult == nil, let presenter else {
      reply(FlutterError(code: "picker_busy", message: "暂时无法打开系统选取器。", details: nil))
      return
    }
    if camera {
      guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
        reply(FlutterError(code: "no_camera", message: "当前相机不可用，请从照片或文件导入。", details: nil))
        return
      }
      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.mediaTypes = [UTType.image.identifier]
      picker.cameraCaptureMode = .photo
      picker.delegate = self
      picker.modalPresentationStyle = .fullScreen
      pickerResult = reply
      presenter.present(picker, animated: true)
    } else {
      var configuration = PHPickerConfiguration(photoLibrary: .shared())
      configuration.filter = .images
      configuration.selectionLimit = 1
      configuration.preferredAssetRepresentationMode = .current
      let picker = PHPickerViewController(configuration: configuration)
      picker.delegate = self
      picker.isModalInPresentation = true
      pickerResult = reply
      presenter.present(picker, animated: true)
    }
  }

  private func finishPicker(_ value: Any?) {
    let reply = pickerResult
    pickerResult = nil
    reply?(value)
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    picker.dismiss(animated: true) { self.finishPicker(nil) }
  }

  func imagePickerController(_ picker: UIImagePickerController,
    didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
    picker.dismiss(animated: true) {
      guard let image = info[.originalImage] as? UIImage,
            let data = image.jpegData(compressionQuality: 0.95) else {
        self.finishPicker(FlutterError(code: "photo_failed", message: "无法读取拍摄的票面，请重试。", details: nil))
        return
      }
      self.finishPicker(FlutterStandardTypedData(bytes: data))
    }
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true) {
      guard let provider = results.first?.itemProvider else {
        self.finishPicker(nil)
        return
      }
      provider.loadDataRepresentation(forTypeIdentifier: "public.image") { data, _ in
        DispatchQueue.main.async {
          if let data, data.count <= 80_000_000 {
            self.finishPicker(FlutterStandardTypedData(bytes: data))
          } else {
            self.finishPicker(FlutterError(code: "photo_failed", message: "无法读取所选照片，或照片超过 80 MB。", details: nil))
          }
        }
      }
    }
  }

  private func shareFile(_ args: [String: Any], reply: @escaping FlutterResult) throws {
    guard let presenter, let name = args["name"] as? String,
          !name.isEmpty, name != ".", name != "..", !name.contains("/"),
          let bytes = args["bytes"] as? FlutterStandardTypedData
    else {
      reply(FlutterError(code: "share_file", message: "无法分享此文件。", details: nil))
      return
    }
    let manager = FileManager.default
    let directory = manager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try manager.createDirectory(at: directory, withIntermediateDirectories: false)
    let file = directory.appendingPathComponent(name)
    do { try bytes.data.write(to: file, options: [.atomic, .completeFileProtection]) }
    catch {
      try? manager.removeItem(at: directory)
      throw error
    }
    let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    if let popover = sheet.popoverPresentationController {
      popover.sourceView = presenter.view
      let bounds = presenter.view.bounds
      popover.sourceRect = CGRect(x: bounds.midX, y: bounds.midY, width: 1, height: 1)
      popover.permittedArrowDirections = []
    }
    sheet.completionWithItemsHandler = { _, _, _, error in
      try? manager.removeItem(at: directory)
      if error == nil { reply(nil) }
      else { reply(FlutterError(code: "share_failed", message: "系统未能分享文件。", details: nil)) }
    }
    presenter.present(sheet, animated: true)
  }

  private func presentMonthDay(_ args: [String: Any], reply: @escaping FlutterResult) {
    guard let presenter else {
      reply(FlutterError(code: "month_day_picker", message: "暂时无法打开月日选择器。", details: nil))
      return
    }
    let selection = MonthDaySelection(
      year: args["year"] as? Int ?? 2000,
      month: args["month"] as? Int ?? 1,
      day: args["day"] as? Int ?? 1
    )
    let picker = UIPickerView()
    picker.dataSource = selection
    picker.delegate = selection
    picker.selectRow(selection.month - 1, inComponent: 0, animated: false)
    picker.selectRow(selection.day - 1, inComponent: 1, animated: false)
    presentWheel(picker, title: "选择月日", on: presenter, reply: reply) {
      [selection.month, selection.day]
    }
  }

  private func presentDatePicker(_ args: [String: Any], reply: @escaping FlutterResult) {
    guard let presenter, let initial = args["initial"] as? [Int], initial.count == 3 else {
      reply(FlutterError(code: "date_picker", message: "暂时无法打开系统日期选择器。", details: nil))
      return
    }
    let picker = UIDatePicker()
    let calendar = Calendar(identifier: .gregorian)
    func date(_ key: String) -> Date? {
      guard let parts = args[key] as? [Int], parts.count == 3 else { return nil }
      return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }
    picker.datePickerMode = .date
    picker.preferredDatePickerStyle = .wheels
    picker.calendar = calendar
    picker.locale = Locale(identifier: "zh_CN")
    picker.minimumDate = date("first")
    picker.maximumDate = date("last")
    picker.date = date("initial") ?? Date()

    presentWheel(picker, title: "选择日期", on: presenter, reply: reply) {
      let components = calendar.dateComponents([.year, .month, .day], from: picker.date)
      return [components.year!, components.month!, components.day!]
    }
  }

  private func presentTimePicker(_ args: [String: Any], reply: @escaping FlutterResult) {
    guard let presenter else {
      reply(FlutterError(code: "time_picker", message: "暂时无法打开系统时间选择器。", details: nil))
      return
    }
    let calendar = Calendar(identifier: .gregorian)
    let picker = UIDatePicker()
    picker.datePickerMode = .time
    picker.preferredDatePickerStyle = .wheels
    picker.calendar = calendar
    picker.locale = Locale(identifier: "zh_CN")
    picker.date = calendar.date(bySettingHour: args["hour"] as? Int ?? 9,
                                minute: args["minute"] as? Int ?? 0,
                                second: 0, of: Date()) ?? Date()
    presentWheel(picker, title: "选择时间", on: presenter, reply: reply) {
      let components = calendar.dateComponents([.hour, .minute], from: picker.date)
      return [components.hour!, components.minute!]
    }
  }

  private func presentWheel(
    _ picker: UIView, title: String, on presenter: UIViewController,
    reply: @escaping FlutterResult, selection: @escaping () -> [Int]
  ) {
    presenter.view.endEditing(true)
    let content = UIViewController()
    content.title = title
    content.view.backgroundColor = .systemBackground
    content.view.addSubview(picker)
    picker.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      picker.topAnchor.constraint(equalTo: content.view.safeAreaLayoutGuide.topAnchor, constant: 6),
      picker.bottomAnchor.constraint(equalTo: content.view.safeAreaLayoutGuide.bottomAnchor, constant: -6),
      picker.leadingAnchor.constraint(equalTo: content.view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
      picker.trailingAnchor.constraint(equalTo: content.view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
    ])
    let navigation = PickerSheetNavigation(root: content, result: reply)
    configureSheet(navigation, height: 234, allowsDismissal: true)
    content.navigationItem.leftBarButtonItem = UIBarButtonItem(
      title: "取消", primaryAction: UIAction { [weak navigation] _ in
        navigation?.closePicker(nil)
      }
    )
    content.navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: "完成", primaryAction: UIAction { [weak navigation] _ in
        let value = selection()
        navigation?.closePicker(value)
      }
    )
    presenter.present(navigation, animated: true)
  }
}

private final class PickerSheetNavigation: UINavigationController,
    UIAdaptivePresentationControllerDelegate, UIGestureRecognizerDelegate {
  private var result: FlutterResult?
  private lazy var outsideTap = UITapGestureRecognizer(target: self, action: #selector(tapOutside))

  init(root: UIViewController, result: @escaping FlutterResult) {
    self.result = result
    super.init(rootViewController: root)
  }

  required init?(coder: NSCoder) { return nil }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    presentationController?.delegate = self
    outsideTap.delegate = self
    outsideTap.cancelsTouchesInView = false
    presentationController?.containerView?.addGestureRecognizer(outsideTap)
  }

  override func viewDidDisappear(_ animated: Bool) {
    outsideTap.view?.removeGestureRecognizer(outsideTap)
    super.viewDidDisappear(animated)
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    guard let sheet = presentationController?.presentedView else { return false }
    return !sheet.bounds.contains(touch.location(in: sheet))
  }

  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
    true
  }

  @objc private func tapOutside() { closePicker(nil) }

  func closePicker(_ value: [Int]?) {
    guard let callback = result else { return }
    result = nil
    dismiss(animated: true) { callback(value) }
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    let callback = result
    result = nil
    callback?(nil)
  }
}

private final class MonthDaySelection: NSObject, UIPickerViewDataSource, UIPickerViewDelegate {
  let year: Int
  var month: Int
  var day: Int

  init(year: Int, month: Int, day: Int) {
    self.year = year
    self.month = min(12, max(1, month))
    self.day = max(1, day)
    super.init()
    self.day = min(self.day, days)
  }

  private var days: Int {
    let calendar = Calendar(identifier: .gregorian)
    guard let date = calendar.date(from: DateComponents(year: year, month: month, day: 1))
    else { return 31 }
    return calendar.range(of: .day, in: .month, for: date)?.count ?? 31
  }

  func numberOfComponents(in pickerView: UIPickerView) -> Int { 2 }

  func pickerView(_ pickerView: UIPickerView, numberOfRowsInComponent component: Int) -> Int {
    component == 0 ? 12 : days
  }

  func pickerView(_ pickerView: UIPickerView, titleForRow row: Int, forComponent component: Int) -> String? {
    "\(row + 1)\(component == 0 ? "月" : "日")"
  }

  func pickerView(_ pickerView: UIPickerView, didSelectRow row: Int, inComponent component: Int) {
    if component == 0 {
      month = row + 1
      day = min(day, days)
      pickerView.reloadComponent(1)
      pickerView.selectRow(day - 1, inComponent: 1, animated: false)
    } else {
      day = row + 1
    }
  }
}

private struct UploadSourceSheet: View {
  let select: (String) -> Void

  var body: some View {
    List {
      Button { select("photos") } label: { Label("上传图片", systemImage: "photo.on.rectangle") }
      Button { select("files") } label: { Label("上传文件", systemImage: "folder") }
    }
    .listStyle(.insetGrouped)
  }
}

@available(iOS 16.0, *)
extension ApplePlatform: DataScannerViewControllerDelegate {
  private func presentBoardingScanner(_ reply: @escaping FlutterResult) {
    guard pickerResult == nil, let presenter else {
      reply(FlutterError(code: "picker_busy", message: "暂时无法打开扫码。", details: nil))
      return
    }
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: AppleRecognition.boardingSymbologies)],
      qualityLevel: .accurate,
      recognizesMultipleItems: true,
      isHighFrameRateTrackingEnabled: true,
      isHighlightingEnabled: true
    )
    pickerResult = reply
    closingBoardingScanner = false
    scanner.title = "对准登机牌条码或二维码"
    scanner.delegate = self
    scanner.navigationItem.leftBarButtonItem = UIBarButtonItem(
      systemItem: .cancel,
      primaryAction: UIAction { [weak self, weak scanner] _ in
        if let scanner { self?.finishBoardingScanner(scanner, result: nil) }
      }
    )
    let navigation = UINavigationController(rootViewController: scanner)
    navigation.modalPresentationStyle = .fullScreen
    presenter.present(navigation, animated: true) {
      do { try scanner.startScanning() }
      catch {
        self.finishBoardingScanner(scanner, result: FlutterError(
          code: "scanner_unavailable", message: "无法扫码，请检查相机权限或上传条码图片。", details: nil))
      }
    }
  }

  private func finishBoardingScanner(_ scanner: DataScannerViewController, result: Any?) {
    guard !closingBoardingScanner, pickerResult != nil else { return }
    closingBoardingScanner = true
    scanner.stopScanning()
    scanner.dismiss(animated: true) { self.finishPicker(result) }
  }

  private func readBoardingCodes(_ scanner: DataScannerViewController, items: [RecognizedItem]) {
    let payloads = Set(items.compactMap { item -> Data? in
      guard case let .barcode(barcode) = item,
            let bytes = AppleRecognition.payload(of: barcode.observation),
            AppleRecognition.isBoardingPayload(bytes)
      else { return nil }
      return bytes
    })
    if payloads.count == 1, let bytes = payloads.first {
      finishBoardingScanner(scanner, result: FlutterStandardTypedData(bytes: bytes))
    }
  }

  func dataScanner(_ scanner: DataScannerViewController, didAdd added: [RecognizedItem], allItems: [RecognizedItem]) {
    readBoardingCodes(scanner, items: allItems)
  }

  func dataScanner(_ scanner: DataScannerViewController, didUpdate updated: [RecognizedItem], allItems: [RecognizedItem]) {
    readBoardingCodes(scanner, items: allItems)
  }

  func dataScanner(_ scanner: DataScannerViewController, didRemove removed: [RecognizedItem], allItems: [RecognizedItem]) {
    readBoardingCodes(scanner, items: allItems)
  }

  func dataScanner(_ scanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
    finishBoardingScanner(scanner, result: FlutterError(
      code: "scanner_unavailable", message: "实时扫码暂不可用，可以上传条码图片。", details: nil))
  }
}

enum AppleKeychain {
  private static func query(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: (Bundle.main.bundleIdentifier ?? "dev.yuanzesun.xingji") + ".credentials",
      kSecAttrAccount as String: account,
    ]
  }

  static func read(_ account: String) throws -> String? {
    var request = query(account)
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &value)
    if status == errSecItemNotFound { return nil }
    try check(status)
    return (value as? Data).flatMap { String(data: $0, encoding: .utf8) }
  }

  static func write(_ value: String, to account: String) throws {
    let request = query(account)
    let data = Data(value.utf8)
    let updated = SecItemUpdate(request as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if updated == errSecItemNotFound {
      var item = request
      item[kSecValueData as String] = data
      item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      try check(SecItemAdd(item as CFDictionary, nil))
    } else {
      try check(updated)
    }
  }

  static func remove(_ account: String) throws {
    let status = SecItemDelete(query(account) as CFDictionary)
    if status != errSecItemNotFound { try check(status) }
  }

  private static func check(_ status: OSStatus) throws {
    if status != errSecSuccess {
      throw NSError(domain: "XingjiKeychain", code: Int(status), userInfo: [
        NSLocalizedDescriptionKey: "无法访问系统钥匙串（\(status)）。",
      ])
    }
  }
}
