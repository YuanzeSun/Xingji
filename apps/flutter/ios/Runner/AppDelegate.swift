import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let applePlatform = ApplePlatform()

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    applePlatform.install(on: engineBridge.applicationRegistrar.messenger())
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "XingjiMap") {
      registrar.register(AppleJourneyMapFactory(), withId: AppleJourneyMapFactory.viewType)
    }
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "XingjiNavigation") {
      registrar.register(
        AppleNavigationBarFactory(messenger: registrar.messenger()),
        withId: AppleNavigationBarFactory.viewType
      )
    }
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "XingjiTextField") {
      registrar.register(
        AppleTextFieldFactory(messenger: registrar.messenger()),
        withId: AppleTextFieldFactory.viewType
      )
    }
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "XingjiChoiceMenu") {
      registrar.register(
        AppleChoiceMenuFactory(messenger: registrar.messenger()),
        withId: AppleChoiceMenuFactory.viewType
      )
    }
  }
}
