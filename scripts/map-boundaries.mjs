export function countryBoundaryClass(properties) {
  return properties.FCLASS_CN || properties.FEATURECLA;
}

export function includeCountryBoundary(feature) {
  return countryBoundaryClass(feature.properties) === 'International boundary (verify)';
}
