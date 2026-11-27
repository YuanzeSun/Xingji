export function includeCountryBoundary({ properties }) {
  return (properties.FCLASS_CN || properties.FEATURECLA) === 'International boundary (verify)';
}
