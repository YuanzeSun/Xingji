import AppIntents
import Foundation

@available(iOS 16.0, *)
struct ImportTravelMessage: AppIntent {
  static let title: LocalizedStringResource = "导入行程短信"
  static let description = IntentDescription("把快捷指令传入的行程短信加入行迹。")
  static let openAppWhenRun = false

  @Parameter(title: "短信正文")
  var message: String

  static var parameterSummary: some ParameterSummary {
    Summary("将 \(\.$message) 导入行迹")
  }

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    try TravelMessageInbox.enqueue(message)
    return .result(dialog: "已收到短信。打开行迹继续导入。")
  }
}

@available(iOS 16.0, *)
struct CollectTicketFiles: AppIntent {
  static let title: LocalizedStringResource = "收集票据文件"
  static let description = IntentDescription("把分享的登机牌、PDF 或图片加入行迹的分享收件箱。")
  static let openAppWhenRun = false

  @Parameter(title: "票据文件")
  var files: [IntentFile]

  static var parameterSummary: some ParameterSummary {
    Summary("把 \(\.$files) 加入分享收件箱")
  }

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard !files.isEmpty, files.count <= 8 else {
      throw TicketCollectionError.fileCount
    }
    var received = 0
    var failure: Error?
    for file in files {
      do {
        guard let kind = file.type.flatMap({ SharedTicketInbox.Kind.type(for: $0.identifier) })
                ?? SharedTicketInbox.Kind.filename(file.filename) else {
          throw SharedTicketInbox.InboxError.unsupported
        }
        if let url = file.fileURL {
          try SharedTicketInbox.enqueue(url: url, name: file.filename, kind: kind, sharedOnly: false)
        } else {
          try SharedTicketInbox.enqueue(data: file.data, name: file.filename, kind: kind, sharedOnly: false)
        }
        received += 1
      } catch {
        failure = error
      }
    }
    guard received > 0 else { throw failure ?? SharedTicketInbox.InboxError.unsupported }
    if received < files.count {
      return .result(dialog: "收到 \(received) 个文件。部分文件未能接收，请打开行迹的分享收件箱核对。")
    }
    return .result(dialog: "收到 \(received) 个文件。请打开行迹的分享收件箱核对。")
  }

  private enum TicketCollectionError: LocalizedError {
    case fileCount

    var errorDescription: String? { "请选择 1 至 8 个票据文件。" }
  }
}

@available(iOS 16.0, *)
struct XingjiShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ImportTravelMessage(),
      phrases: ["用 \(.applicationName) 导入行程短信"],
      shortTitle: "导入行程短信",
      systemImageName: "message"
    )
  }
}

@MainActor
enum TravelMessageInbox {
  struct Entry: Codable {
    let id: String
    let text: String
    let receivedAt: Double
  }

  private static func location() throws -> URL {
    let directory = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask,
      appropriateFor: nil, create: true
    )
    return directory.appendingPathComponent("xingji-travel-messages.json")
  }

  static func entries() throws -> [Entry] {
    let url = try location()
    guard FileManager.default.fileExists(atPath: url.path) else { return [] }
    return try JSONDecoder().decode([Entry].self, from: Data(contentsOf: url))
  }

  private static func save(_ entries: [Entry]) throws {
    var url = try location()
    try JSONEncoder().encode(entries).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try url.setResourceValues(values)
  }

  static func enqueue(_ message: String) throws {
    let body = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !body.isEmpty, body.count <= 4_000 else { throw InboxError.invalid }
    guard body.range(of: #"车次|乘车|次列车|航班|登机|乘机|机场|[A-Z]{1,2}[0-9]{2,5}"#,
                     options: [.regularExpression, .caseInsensitive]) != nil,
          body.range(of: #"验证码|校验码|confirmation code|verification code|one.time password"#,
                     options: [.regularExpression, .caseInsensitive]) == nil
    else { throw InboxError.unrelated }
    var queue = try entries()
    guard !queue.contains(where: { $0.text == body }) else { return }
    guard queue.count < 64 else { throw InboxError.full }
    queue.append(Entry(id: UUID().uuidString.lowercased(), text: body, receivedAt: Date().timeIntervalSince1970))
    try save(queue)
  }

  static func acknowledge(_ id: String) throws {
    let queue = try entries()
    let remaining = queue.filter { $0.id != id }
    if queue.count != remaining.count { try save(remaining) }
  }

  enum InboxError: LocalizedError {
    case invalid, unrelated, full

    var errorDescription: String? {
      switch self {
      case .invalid: return "请传入一条完整的短信正文。"
      case .unrelated: return "这条短信不是行程通知。"
      case .full: return "行程短信收件箱已满，请先打开行迹处理。"
      }
    }
  }
}
