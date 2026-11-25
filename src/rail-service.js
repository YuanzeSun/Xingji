export const RAIL_SERVICE_PREFIXES = 'GDCZTKYLSNVX';

const singleService = `(?:[${RAIL_SERVICE_PREFIXES}]\\d{1,5}|\\d{3,5})`;
const singlePattern = new RegExp(`^${singleService}$`);
const combinedPattern = new RegExp(`^${singleService}(?:/[${RAIL_SERVICE_PREFIXES}]?\\d{1,5})*$`);
export const isRailService = (value, { combined = false } = {}) => (combined ? combinedPattern : singlePattern).test(value);

export const RAIL_OCR_SERVICE = new RegExp(`(?<![A-Z0-9])([${RAIL_SERVICE_PREFIXES}]\\s*[0-9OIL]{1,5})(?![A-Z0-9])`, 'gi');
