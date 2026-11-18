import Flutter
import UIKit

final class AppleTextFieldFactory: NSObject, FlutterPlatformViewFactory {
  static let viewType = "dev.yuanzesun.xingji/text-field"
  let messenger: FlutterBinaryMessenger

  init(messenger: FlutterBinaryMessenger) { self.messenger = messenger }

  func createArgsCodec() -> (any FlutterMessageCodec & NSObjectProtocol) {
    FlutterStandardMessageCodec.sharedInstance()
  }

  func create(withFrame frame: CGRect, viewIdentifier id: Int64, arguments: Any?) -> any FlutterPlatformView {
    AppleTextField(frame: frame, id: id, arguments: arguments, messenger: messenger)
  }
}

final class AppleChoiceMenuFactory: NSObject, FlutterPlatformViewFactory {
  static let viewType = "dev.yuanzesun.xingji/choice-menu"
  let messenger: FlutterBinaryMessenger

  init(messenger: FlutterBinaryMessenger) { self.messenger = messenger }

  func createArgsCodec() -> (any FlutterMessageCodec & NSObjectProtocol) {
    FlutterStandardMessageCodec.sharedInstance()
  }

  func create(withFrame frame: CGRect, viewIdentifier id: Int64, arguments: Any?) -> any FlutterPlatformView {
    AppleChoiceMenu(frame: frame, id: id, arguments: arguments, messenger: messenger)
  }
}

private final class AppleChoiceMenu: NSObject, FlutterPlatformView {
  private let button: UIButton
  private let valueLabel = UILabel()
  private let channel: FlutterMethodChannel

  init(frame: CGRect, id: Int64, arguments: Any?, messenger: FlutterBinaryMessenger) {
    button = UIButton(type: .system)
    button.frame = frame
    channel = FlutterMethodChannel(name: "\(AppleChoiceMenuFactory.viewType)/\(id)", binaryMessenger: messenger)
    super.init()
    button.showsMenuAsPrimaryAction = true
    button.backgroundColor = .white
    button.layer.cornerRadius = 10
    valueLabel.font = .preferredFont(forTextStyle: .body)
    valueLabel.adjustsFontForContentSizeCategory = true
    valueLabel.textColor = .black
    valueLabel.lineBreakMode = .byTruncatingTail
    let chevron = UIImageView(image: UIImage(systemName: "chevron.down",
      withConfiguration: UIImage.SymbolConfiguration(pointSize: 12, weight: .semibold)))
    chevron.tintColor = .secondaryLabel
    chevron.setContentHuggingPriority(.required, for: .horizontal)
    chevron.setContentCompressionResistancePriority(.required, for: .horizontal)
    let row = UIStackView(arrangedSubviews: [valueLabel, chevron])
    row.alignment = .center
    row.spacing = 10
    row.isUserInteractionEnabled = false
    row.accessibilityElementsHidden = true
    button.addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 12),
      row.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -12),
      row.centerYAnchor.constraint(equalTo: button.centerYAnchor),
    ])
    update(arguments)
    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "update" else { result(FlutterMethodNotImplemented); return }
      self?.update(call.arguments)
      result(nil)
    }
  }

  deinit { channel.setMethodCallHandler(nil) }

  func view() -> UIView { button }

  private func update(_ arguments: Any?) {
    guard let model = arguments as? [String: Any], let choices = model["choices"] as? [String] else { return }
    let selected = model["selected"] as? Int ?? -1
    let title = choices.indices.contains(selected) ? choices[selected] : "选择"
    valueLabel.text = title
    button.accessibilityLabel = model["label"] as? String
    button.accessibilityValue = title
    button.isEnabled = model["enabled"] as? Bool ?? true
    button.menu = UIMenu(children: choices.enumerated().map { index, choice in
      UIAction(title: choice, state: index == selected ? .on : .off) { [weak self] _ in
        self?.channel.invokeMethod("select", arguments: index)
      }
    })
  }
}

private final class AppleTextField: NSObject, FlutterPlatformView, UITextFieldDelegate {
  private let input: UITextField
  private let channel: FlutterMethodChannel

  init(frame: CGRect, id: Int64, arguments: Any?, messenger: FlutterBinaryMessenger) {
    input = UITextField(frame: frame)
    channel = FlutterMethodChannel(name: "\(AppleTextFieldFactory.viewType)/\(id)", binaryMessenger: messenger)
    super.init()
    input.delegate = self
    input.borderStyle = .roundedRect
    input.font = .preferredFont(forTextStyle: .body)
    input.adjustsFontForContentSizeCategory = true
    input.textColor = .black
    input.backgroundColor = .white
    input.autocorrectionType = .no
    input.spellCheckingType = .no
    input.smartDashesType = .no
    input.smartQuotesType = .no
    input.autocapitalizationType = .none
    input.returnKeyType = .done
    input.addTarget(self, action: #selector(edited), for: .editingChanged)
    update(arguments)
    channel.setMethodCallHandler { [weak self] call, result in
      guard call.method == "update" else {
        result(FlutterMethodNotImplemented)
        return
      }
      self?.update(call.arguments)
      result(nil)
    }
  }

  deinit { channel.setMethodCallHandler(nil) }

  func view() -> UIView { input }

  private func update(_ arguments: Any?) {
    guard let state = arguments as? [String: Any] else { return }
    let value = state["text"] as? String ?? ""
    if input.text != value { input.text = value }
    input.accessibilityLabel = state["label"] as? String
    input.isEnabled = state["enabled"] as? Bool ?? true
    input.isSecureTextEntry = state["secret"] as? Bool ?? false
    input.keyboardType = (state["numeric"] as? Bool == true) ? .numberPad : .asciiCapable
    input.clearButtonMode = input.isSecureTextEntry ? .never : .whileEditing
  }

  @objc private func edited() { channel.invokeMethod("change", arguments: input.text ?? "") }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    textField.resignFirstResponder()
    return false
  }
}
