import Flutter
import MapKit
import UIKit

final class AppleJourneyMapFactory: NSObject, FlutterPlatformViewFactory {
  static let viewType = "dev.yuanzesun.xingji/apple-map"

  func createArgsCodec() -> (any FlutterMessageCodec & NSObjectProtocol) {
    FlutterStandardMessageCodec.sharedInstance()
  }

  func create(withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?) -> any FlutterPlatformView {
    AppleJourneyMap(frame: frame, settings: args as? [String: Any] ?? [:])
  }
}

private final class AppleJourneyMap: NSObject, FlutterPlatformView, MKMapViewDelegate {
  private let map: MKMapView
  private let host: JourneyMapHost
  private var lineNames: [(UILabel, [CLLocationCoordinate2D])] = []
  private var flightPaths: [ObjectIdentifier: Int] = [:]
  private let routeColor = UIColor(red: 0.17, green: 0.34, blue: 0.57, alpha: 1)

  init(frame: CGRect, settings: [String: Any]) {
    map = MKMapView(frame: frame)
    host = JourneyMapHost(frame: frame)
    super.init()
    host.addSubview(map)
    map.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      map.topAnchor.constraint(equalTo: host.topAnchor),
      map.bottomAnchor.constraint(equalTo: host.bottomAnchor),
      map.leadingAnchor.constraint(equalTo: host.leadingAnchor),
      map.trailingAnchor.constraint(equalTo: host.trailingAnchor),
    ])
    host.clipsToBounds = true
    host.onLayout = { [weak self] in self?.layoutLineNames() }
    map.delegate = self
    map.isRotateEnabled = false
    map.isPitchEnabled = false
    map.showsUserLocation = false
    map.showsCompass = false
    map.showsScale = false
    if #available(iOS 16, *) {
      let configuration = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
      configuration.pointOfInterestFilter = .excludingAll
      configuration.showsTraffic = false
      map.preferredConfiguration = configuration
      map.selectableMapFeatures = []
    } else {
      map.mapType = .mutedStandard
      map.pointOfInterestFilter = .excludingAll
      map.showsTraffic = false
    }
    let fitLocations = (settings["pins"] as? [[String: Any]] ?? []).compactMap {
      Self.coordinate($0["coordinate"])
    }
    for source in settings["lineLabels"] as? [[String: Any]] ?? [] {
      guard let name = source["name"] as? String, !name.isEmpty else { continue }
      let locations = (source["coordinates"] as? [[Double]] ?? []).compactMap(Self.coordinate)
      guard !locations.isEmpty else { continue }
      let label = UILabel()
      label.attributedText = NSAttributedString(string: name, attributes: [
        .font: UIFont.systemFont(ofSize: UIFont.preferredFont(forTextStyle: .caption1).pointSize, weight: .semibold),
        .foregroundColor: UIColor.black,
        .strokeColor: UIColor.white,
        .strokeWidth: -3,
      ])
      label.sizeToFit()
      label.accessibilityLabel = name
      label.isUserInteractionEnabled = false
      label.isHidden = true
      host.addSubview(label)
      lineNames.append((label, locations))
    }
    let segments = (settings["segments"] as? [[[Double]]] ?? []).map { $0.compactMap(Self.coordinate) }
    let links = (settings["links"] as? [[[Double]]] ?? []).map { $0.compactMap(Self.coordinate) }
    for line in segments where line.count > 1 {
      map.addOverlay(MKPolyline(coordinates: line, count: line.count), level: .aboveLabels)
    }
    for line in links where line.count > 1 {
      map.addOverlay(MKGeodesicPolyline(coordinates: line, count: line.count), level: .aboveLabels)
    }
    var flightPoints: [CLLocationCoordinate2D] = []
    for flight in settings["flights"] as? [[String: Any]] ?? [] {
      let line = (flight["coordinates"] as? [[Double]] ?? []).compactMap(Self.coordinate)
      guard line.count > 1 else { continue }
      let overlay = MKGeodesicPolyline(coordinates: line, count: line.count)
      flightPaths[ObjectIdentifier(overlay)] = flight["count"] as? Int ?? 1
      flightPoints.append(contentsOf: line)
      map.addOverlay(overlay, level: .aboveLabels)
    }
    fit(segments.flatMap { $0 } + links.flatMap { $0 } + flightPoints + fitLocations)
  }

  func view() -> UIView { host }

  func mapViewDidChangeVisibleRegion(_ mapView: MKMapView) {
    layoutLineNames()
  }

  private func layoutLineNames() {
    let inset = host.bounds.insetBy(dx: 8, dy: 16)
    guard inset.width > 0, inset.height > 0 else { return }
    var occupied: [CGRect] = []
    let center = CGPoint(x: inset.midX, y: inset.midY)
    for (label, locations) in lineNames {
      let candidates = locations.compactMap { coordinate -> CGRect? in
        let point = map.convert(coordinate, toPointTo: host)
        let frame = CGRect(
          x: point.x - label.bounds.width / 2,
          y: point.y - label.bounds.height - 8,
          width: label.bounds.width,
          height: label.bounds.height
        )
        return inset.contains(frame) ? frame : nil
      }.sorted {
        hypot($0.midX - center.x, $0.midY - center.y)
          < hypot($1.midX - center.x, $1.midY - center.y)
      }
      if let frame = candidates.first(where: { frame in
        !occupied.contains(where: { $0.intersects(frame.insetBy(dx: -4, dy: -2)) })
      }) {
        label.frame = frame
        label.isHidden = false
        occupied.append(frame)
      } else {
        label.isHidden = true
      }
    }
  }

  func mapView(_ mapView: MKMapView, rendererFor overlay: any MKOverlay) -> MKOverlayRenderer {
    if let line = overlay as? MKPolyline {
      let renderer = MKPolylineRenderer(polyline: line)
      let flights = flightPaths[ObjectIdentifier(line)]
      renderer.strokeColor = flights == nil
        ? routeColor
        : UIColor(red: 0.71, green: 0.28, blue: 0.34, alpha: 1)
      renderer.lineWidth = flights.map { min(4, 1.5 + 0.65 * sqrt(Double($0 - 1))) } ?? 3
      renderer.lineCap = .round
      renderer.lineJoin = .round
      if line is MKGeodesicPolyline { renderer.lineDashPattern = [6, 5] }
      return renderer
    }
    return MKOverlayRenderer(overlay: overlay)
  }

  private static func coordinate(_ value: Any?) -> CLLocationCoordinate2D? {
    guard let pair = value as? [Double], pair.count == 2 else { return nil }
    let result = CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
    return CLLocationCoordinate2DIsValid(result) ? result : nil
  }

  private func fit(_ points: [CLLocationCoordinate2D]) {
    guard !points.isEmpty else {
      map.setRegion(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 34, longitude: 105),
        span: MKCoordinateSpan(latitudeDelta: 30, longitudeDelta: 45)
      ), animated: false)
      return
    }
    let latitudes = points.map(\.latitude), longitudes = points.map { ($0.longitude + 360).truncatingRemainder(dividingBy: 360) }.sorted()
    let low = latitudes.min()!, high = latitudes.max()!
    var gap = -1.0, start = longitudes[0]
    for index in longitudes.indices {
      let next = index + 1 < longitudes.count ? longitudes[index + 1] : longitudes[0] + 360
      if next - longitudes[index] > gap {
        gap = next - longitudes[index]
        start = next
      }
    }
    let span = 360 - gap
    let center = (start + span / 2 + 180).truncatingRemainder(dividingBy: 360) - 180
    map.setRegion(MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: (low + high) / 2, longitude: center),
      span: MKCoordinateSpan(latitudeDelta: max(0.35, (high - low) * 1.4),
                             longitudeDelta: min(350, max(0.35, span * 1.35)))
    ), animated: false)
  }
}

private final class JourneyMapHost: UIView {
  var onLayout: (() -> Void)?

  override func layoutSubviews() {
    super.layoutSubviews()
    onLayout?()
  }
}
