const EARTH_MEAN_RADIUS_KM = 6371.0088;

export function pathDistanceKm(segments) {
  const radians = Math.PI / 180;
  let distance = 0;
  for (const line of segments) {
    for (let index = 1; index < line.length; index++) {
      const [fromLon, fromLat] = line[index - 1], [toLon, toLat] = line[index];
      const arc = Math.sin((toLat - fromLat) * radians / 2) ** 2
        + Math.cos(fromLat * radians) * Math.cos(toLat * radians) * Math.sin((toLon - fromLon) * radians / 2) ** 2;
      distance += 2 * EARTH_MEAN_RADIUS_KM * Math.asin(Math.sqrt(Math.min(arc, 1)));
    }
  }
  return distance;
}
