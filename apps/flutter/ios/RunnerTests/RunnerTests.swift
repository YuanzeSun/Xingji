import Flutter
import Testing
import UIKit
@testable import Runner

struct RunnerTests {
  @Test @MainActor
  func visionRecognizesTicketTextAndReturnsTopOriginCoordinates() async throws {
    let image = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 400)).image { context in
      UIColor.white.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 800, height: 400))
      ("FLIGHT CA181" as NSString).draw(at: CGPoint(x: 50, y: 40), withAttributes: [
        .font: UIFont.monospacedSystemFont(ofSize: 60, weight: .semibold),
        .foregroundColor: UIColor.black,
      ])
    }
    let data = try #require(image.pngData())
    let output: [String: Any]? = await withCheckedContinuation { continuation in
      AppleRecognition.recognize(data, languages: ["en"], barcodes: true) { value in
        continuation.resume(returning: value as? [String: Any])
      }
    }
    let lines = try #require(output?["lines"] as? [[String: Any]])
    let line = try #require(lines.first { ($0["text"] as? String)?.contains("CA181") == true })
    let y = try #require(line["y"] as? Double)
    #expect(y >= 0 && y < 0.4)
  }

  @Test
  func keychainUpdatesAndDeletesAnAppCredential() throws {
    let account = "ios-test:\(UUID().uuidString)"
    defer { try? AppleKeychain.remove(account) }
    #expect(try AppleKeychain.read(account) == nil)
    try AppleKeychain.write("test-key-1", to: account)
    #expect(try AppleKeychain.read(account) == "test-key-1")
    try AppleKeychain.write("test-key-2", to: account)
    #expect(try AppleKeychain.read(account) == "test-key-2")
    try AppleKeychain.remove(account)
    #expect(try AppleKeychain.read(account) == nil)
  }
}
