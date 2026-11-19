import Flutter
import OSLog
import UIKit

class SceneDelegate: FlutterSceneDelegate {
  private let lifecycleLog = Logger(subsystem: "dev.yuanzesun.xingji", category: "Lifecycle")

  override func sceneDidEnterBackground(_ scene: UIScene) {
    super.sceneDidEnterBackground(scene)
    lifecycleLog.info("Scene entered background")
  }

  override func sceneWillEnterForeground(_ scene: UIScene) {
    super.sceneWillEnterForeground(scene)
    AppleRecognition.checkModelAvailability()
    lifecycleLog.info("Scene entered foreground")
  }

  override func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)
    receiveFiles(connectionOptions.urlContexts)
  }

  override func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    let files = URLContexts.filter { $0.url.isFileURL }
    super.scene(scene, openURLContexts: URLContexts.subtracting(files))
    receiveFiles(files)
  }

  private func receiveFiles(_ contexts: Set<UIOpenURLContext>) {
    for context in contexts where context.url.isFileURL {
      let url = context.url
      let name = url.lastPathComponent
      guard let kind = SharedTicketInbox.Kind.filename(name) else { continue }
      if let error = Result(catching: {
        try SharedTicketInbox.enqueue(url: url, name: name, kind: kind, sharedOnly: false)
      }).failure {
        DispatchQueue.main.async { [weak self] in
          guard let host = self?.window?.rootViewController else { return }
          let alert = UIAlertController(title: "无法导入票据", message: error.localizedDescription, preferredStyle: .alert)
          alert.addAction(UIAlertAction(title: "好", style: .default))
          host.present(alert, animated: true)
        }
      }
    }
  }
}

private extension Result {
  var failure: Failure? {
    if case let .failure(error) = self { return error }
    return nil
  }
}
