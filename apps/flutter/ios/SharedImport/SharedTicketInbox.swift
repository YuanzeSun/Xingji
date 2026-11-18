import Foundation
import UniformTypeIdentifiers

enum SharedTicketInbox {
  enum Kind: String, Codable {
    case image, pdf, pkpass

    static func type(for identifier: String) -> Self? {
      if identifier == "com.apple.pkpass" { return .pkpass }
      guard let type = UTType(identifier) else { return nil }
      if type.conforms(to: .pdf) { return .pdf }
      if type.conforms(to: .image) { return .image }
      return nil
    }

    static func filename(_ name: String) -> Self? {
      let suffix = (name as NSString).pathExtension.lowercased()
      if suffix == "pkpass" { return .pkpass }
      return UTType(filenameExtension: suffix).flatMap { type(for: $0.identifier) }
    }

    var limit: Int {
      switch self {
      case .pkpass: return 8 * 1024 * 1024
      case .image, .pdf: return 40_000_000
      }
    }
  }

  struct Entry: Codable {
    let id: UUID
    let name: String
    let kind: Kind
    let added: Date

    var summary: [String: String] {
      ["id": id.uuidString, "name": name, "kind": kind.rawValue]
    }
  }

  enum InboxError: LocalizedError {
    case noAppGroup, unsupported, fileTooLarge, full
    var errorDescription: String? {
      switch self {
      case .noAppGroup: return "此测试版无法通过分享扩展接收文件。可用快捷指令「收集票据文件」，或先存到「文件」再在行迹导入。"
      case .unsupported: return "请选择票据图片、PDF 或 .pkpass 登机牌。"
      case .fileTooLarge: return "文件太大，无法放入行迹收件箱。"
      case .full: return "行迹收件箱已满。请打开行迹处理已有文件。"
      }
    }
  }

  static var groupRoot: URL? {
    guard let identifier = Bundle.main.object(forInfoDictionaryKey: "XingjiAppGroup") as? String,
          identifier.hasPrefix("group.")
    else { return nil }
    return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)?
      .appendingPathComponent("TicketInbox", isDirectory: true)
  }

  private static func privateRoot() throws -> URL {
    try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                               appropriateFor: nil, create: true)
      .appendingPathComponent("TicketInbox", isDirectory: true)
  }

  static func enqueue(url: URL, name: String, kind: Kind, sharedOnly: Bool) throws {
    guard url.isFileURL else { throw InboxError.unsupported }
    let accessed = url.startAccessingSecurityScopedResource()
    defer { if accessed { url.stopAccessingSecurityScopedResource() } }
    let attributes = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
    guard attributes.isRegularFile == true, let size = attributes.fileSize, size > 0 else {
      throw InboxError.unsupported
    }
    guard size <= kind.limit else { throw InboxError.fileTooLarge }
    try enqueue(data: Data(contentsOf: url, options: .mappedIfSafe),
                name: name, kind: kind, sharedOnly: sharedOnly)
  }

  static func enqueue(data: Data, name: String, kind: Kind, sharedOnly: Bool) throws {
    guard !data.isEmpty, data.count <= kind.limit else { throw InboxError.fileTooLarge }
    let manager = FileManager.default
    let root: URL
    if sharedOnly {
      guard let groupRoot else { throw InboxError.noAppGroup }
      root = groupRoot
    } else {
      root = try privateRoot()
    }
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    var protectedRoot = root
    var resourceValues = URLResourceValues()
    resourceValues.isExcludedFromBackup = true
    try protectedRoot.setResourceValues(resourceValues)
    guard try manager.contentsOfDirectory(atPath: root.path).count < 32 else {
      throw InboxError.full
    }
    let id = UUID()
    let entry = Entry(id: id, name: String((name as NSString).lastPathComponent.prefix(160)),
                      kind: kind, added: Date())
    let staging = root.appendingPathComponent("." + id.uuidString, isDirectory: true)
    let destination = root.appendingPathComponent(id.uuidString, isDirectory: true)
    try manager.createDirectory(at: staging, withIntermediateDirectories: false)
    defer { try? manager.removeItem(at: staging) }
    let options: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
    try data.write(to: staging.appendingPathComponent("ticket"), options: options)
    try JSONEncoder().encode(entry).write(to: staging.appendingPathComponent("entry.json"), options: options)
    try manager.moveItem(at: staging, to: destination)
  }

  static func entries() throws -> [Entry] {
    let roots = try [privateRoot()] + (groupRoot.map { [$0] } ?? [])
    return roots.flatMap { root -> [Entry] in
      let files = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
      return files.compactMap { name in
        guard let id = UUID(uuidString: name),
              let data = try? Data(contentsOf: root.appendingPathComponent(name).appendingPathComponent("entry.json")),
              let entry = try? JSONDecoder().decode(Entry.self, from: data), entry.id == id
        else { return nil }
        return entry
      }
    }.sorted { $0.added < $1.added }
  }

  static func data(for id: UUID) throws -> Data? {
    guard let path = try path(for: id) else { return nil }
    return try Data(contentsOf: path.appendingPathComponent("ticket"), options: .mappedIfSafe)
  }

  static func remove(_ id: UUID) throws {
    if let path = try path(for: id) { try FileManager.default.removeItem(at: path) }
  }

  private static func path(for id: UUID) throws -> URL? {
    let roots = try [privateRoot()] + (groupRoot.map { [$0] } ?? [])
    return roots.map { $0.appendingPathComponent(id.uuidString) }
      .first { FileManager.default.fileExists(atPath: $0.path) }
  }
}
