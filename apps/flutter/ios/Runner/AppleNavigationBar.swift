import Flutter
import UIKit

final class AppleNavigationBarFactory: NSObject, FlutterPlatformViewFactory {
  static let viewType = "dev.yuanzesun.xingji/ios-navigation"
  private let messenger: FlutterBinaryMessenger

  init(messenger: FlutterBinaryMessenger) {
    self.messenger = messenger
  }

  func createArgsCodec() -> (any FlutterMessageCodec & NSObjectProtocol) {
    FlutterStandardMessageCodec.sharedInstance()
  }

  func create(withFrame frame: CGRect, viewIdentifier viewID: Int64, arguments args: Any?) -> any FlutterPlatformView {
    AppleNavigationBar(frame: frame, viewID: viewID, args: args, messenger: messenger)
  }
}

private final class AppleNavigationBar: NSObject, FlutterPlatformView, UITabBarControllerDelegate {
  private let root: AppleTabHost
  private let channel: FlutterMethodChannel
  private let controller = UITabBarController()
  private let entry = UIButton(type: .system)
  private let entrySlot = UIView()
  private let ink = UIColor(red: 36 / 255, green: 60 / 255, blue: 101 / 255, alpha: 1)
  private var isDemo: Bool?
  private let pages: [UIViewController] = [
    ("票夹", "ticket"),
    ("地图", "map"),
    ("统计", "chart.bar.xaxis"),
    ("同步", "icloud"),
  ].enumerated().map { index, item in
    let page = UIViewController()
    page.view.backgroundColor = .clear
    page.tabBarItem = UITabBarItem(title: item.0, image: UIImage(systemName: item.1), tag: index)
    page.tabBarItem.accessibilityIdentifier = "xingji-tab-\(index)"
    return page
  }

  init(frame: CGRect, viewID: Int64, args: Any?, messenger: FlutterBinaryMessenger) {
    root = AppleTabHost(frame: frame)
    channel = FlutterMethodChannel(
      name: "\(AppleNavigationBarFactory.viewType)/\(viewID)",
      binaryMessenger: messenger
    )
    super.init()
    root.controller = controller
    makeBar()
    update(args)
    channel.setMethodCallHandler { [weak self] call, reply in
      guard call.method == "update" else {
        reply(FlutterMethodNotImplemented)
        return
      }
      self?.update(call.arguments)
      reply(nil)
    }
  }

  deinit {
    channel.setMethodCallHandler(nil)
  }

  func view() -> UIView { root }

  private func makeBar() {
    let entryDiameter: CGFloat
    let entryCenterOffset: CGFloat
    if #available(iOS 27.0, *) {
      entryDiameter = 62
      // The floating glass capsule sits above the center of the tab bar's layout area.
      entryCenterOffset = -11
    } else {
      entryDiameter = 54
      entryCenterOffset = 0
    }
    controller.delegate = self
    if #available(iOS 18.0, *) { controller.mode = .tabBar }
    if #available(iOS 26.0, *) { controller.tabBarMinimizeBehavior = .never }
    controller.view.backgroundColor = .clear
    controller.view.isOpaque = false
    controller.tabBar.tintColor = ink
    root.backgroundColor = .clear
    root.isOpaque = false

    let controls = UIStackView(arrangedSubviews: [controller.view, entrySlot])
    controls.alignment = .fill
    controls.spacing = 9
    root.addSubview(controls)
    controls.translatesAutoresizingMaskIntoConstraints = false
    let entryWidth = entrySlot.widthAnchor.constraint(equalToConstant: entryDiameter)
    entryWidth.priority = .defaultHigh
    NSLayoutConstraint.activate([
      controls.topAnchor.constraint(equalTo: root.topAnchor),
      controls.bottomAnchor.constraint(equalTo: root.bottomAnchor),
      controls.leadingAnchor.constraint(equalTo: root.leadingAnchor),
      controls.trailingAnchor.constraint(equalTo: root.trailingAnchor),
      entryWidth,
    ])
    entrySlot.addSubview(entry)
    entry.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      entry.leadingAnchor.constraint(equalTo: entrySlot.leadingAnchor),
      entry.trailingAnchor.constraint(equalTo: entrySlot.trailingAnchor),
      entry.heightAnchor.constraint(equalToConstant: entryDiameter),
      entry.centerYAnchor.constraint(equalTo: controller.tabBar.centerYAnchor, constant: entryCenterOffset),
    ])

    var configuration: UIButton.Configuration
    if #available(iOS 26.0, *) {
      configuration = .glass()
      configuration.baseForegroundColor = ink
    } else {
      configuration = .filled()
      configuration.baseBackgroundColor = ink
      configuration.baseForegroundColor = .white
    }
    configuration.cornerStyle = .capsule
    configuration.image = UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(pointSize: 21, weight: .semibold))
    entry.configuration = configuration
    entry.accessibilityLabel = "录入票据"
    entry.accessibilityIdentifier = "xingji-add"
    entry.menu = UIMenu(children: [
      ("camera", "扫描", "camera"),
      ("upload", "上传", "square.and.arrow.up"),
      ("write", "手动填写", "pencil"),
      ("paste", "粘贴", "list.clipboard"),
    ].map { action, title, symbol in
      UIAction(title: title, image: UIImage(systemName: symbol)) { [weak self] _ in
        self?.channel.invokeMethod("add", arguments: action)
      }
    })
    entry.showsMenuAsPrimaryAction = true
  }

  private func update(_ raw: Any?) {
    guard let state = raw as? [String: Any] else { return }
    let demo = state["demo"] as? Bool ?? false
    if isDemo != demo {
      isDemo = demo
      controller.setViewControllers(demo ? Array(pages.prefix(3)) : pages, animated: false)
    }
    let selected = state["selected"] as? Int ?? 0
    if (0..<(controller.viewControllers?.count ?? 0)).contains(selected), controller.selectedIndex != selected {
      controller.selectedIndex = selected
    }
    entrySlot.isHidden = demo
    entry.isEnabled = state["canWrite"] as? Bool ?? false
  }

  func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
    channel.invokeMethod("select", arguments: viewController.tabBarItem.tag)
  }
}

private final class AppleTabHost: UIView {
  weak var controller: UIViewController?

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let controller else { return }
    if window == nil {
      controller.willMove(toParent: nil)
      controller.removeFromParent()
      return
    }
    guard controller.parent == nil else { return }
    var responder = next
    while let current = responder {
      if let parent = current as? UIViewController {
        parent.addChild(controller)
        controller.didMove(toParent: parent)
        return
      }
      responder = current.next
    }
  }
}
