import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private var started = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    let spinner = UIActivityIndicatorView(style: .medium)
    spinner.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(spinner)
    NSLayoutConstraint.activate([
      spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
    spinner.startAnimating()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !started else { return }
    started = true
    Task { await collect() }
  }

  private func collect() async {
    guard SharedTicketInbox.groupRoot != nil else {
      finish(message: SharedTicketInbox.InboxError.noAppGroup.localizedDescription)
      return
    }
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    let attachments = items.flatMap { $0.attachments ?? [] }.prefix(8)
    var count = 0
    var failure: Error?
    for item in attachments {
      do {
        try await enqueue(item)
        count += 1
      } catch {
        failure = error
      }
    }
    if count > 0 {
      let skipped = failure == nil ? "" : " 部分文件未能接收。"
      finish(message: "已收集 \(count) 个文件。打开行迹，在「同步 → 分享收件箱」核对。\(skipped)")
    } else {
      finish(message: failure?.localizedDescription ?? SharedTicketInbox.InboxError.unsupported.localizedDescription)
    }
  }

  private func enqueue(_ item: NSItemProvider) async throws {
    let identifiers = item.registeredTypeIdentifiers
    for identifier in identifiers {
      guard let kind = SharedTicketInbox.Kind.type(for: identifier) else { continue }
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        item.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
          if let url {
            do {
              try SharedTicketInbox.enqueue(url: url, name: item.suggestedName ?? url.lastPathComponent,
                                            kind: kind, sharedOnly: true)
              continuation.resume()
            } catch {
              continuation.resume(throwing: error)
            }
            return
          }
          item.loadDataRepresentation(forTypeIdentifier: identifier) { data, dataError in
            do {
              guard let data else {
                throw dataError ?? error ?? SharedTicketInbox.InboxError.unsupported
              }
              try SharedTicketInbox.enqueue(data: data, name: item.suggestedName ?? self.defaultName(kind),
                                            kind: kind, sharedOnly: true)
              continuation.resume()
            } catch {
              continuation.resume(throwing: error)
            }
          }
        }
      }
      return
    }

    if item.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        item.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, error in
          do {
            let url = (item as? URL) ?? (item as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) }
            guard let url, let kind = SharedTicketInbox.Kind.filename(url.lastPathComponent) else {
              throw error ?? SharedTicketInbox.InboxError.unsupported
            }
            try SharedTicketInbox.enqueue(url: url, name: url.lastPathComponent, kind: kind, sharedOnly: true)
            continuation.resume()
          } catch {
            continuation.resume(throwing: error)
          }
        }
      }
      return
    }
    throw SharedTicketInbox.InboxError.unsupported
  }

  private nonisolated func defaultName(_ kind: SharedTicketInbox.Kind) -> String {
    switch kind {
    case .pkpass: return "电子登机牌.pkpass"
    case .pdf: return "行程.pdf"
    case .image: return "票据图片"
    }
  }

  private func finish(message: String) {
    let alert = UIAlertController(title: "分享到行迹", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "完成", style: .default) { [weak self] _ in
      self?.extensionContext?.completeRequest(returningItems: nil)
    })
    present(alert, animated: true)
  }
}
