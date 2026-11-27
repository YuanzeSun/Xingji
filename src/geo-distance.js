const EARTH_MEAN_RADIUS_KM = 6371.0088;
const radians = Math.PI / 180;

export function distanceKm([fromLon, fromLat], [toLon, toLat]) {
  const arc = Math.sin((toLat - fromLat) * radians / 2) ** 2
    + Math.cos(fromLat * radians) * Math.cos(toLat * radians) * Math.sin((toLon - fromLon) * radians / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_KM * Math.asin(Math.sqrt(Math.min(arc, 1)));
}

export function pathDistanceKm(segments) {
  let distance = 0;
  for (const line of segments) {
    for (let index = 1; index < line.length; index++) distance += distanceKm(line[index - 1], line[index]);
  }
  return distance;
}
