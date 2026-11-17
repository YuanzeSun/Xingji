import { FlightConnector } from './mcp.js';
import { flightCandidates, flightQuery } from './flight-lookup-model.js';

export const FLIGHT_DATA_SOURCES = Object.freeze({ variflight: { name: '飞常准', url: 'https://cmcp.variflight.com/tools/#getFlightStatus' } });
export async function lookupFlight(source, record, key) {
  if (!Object.hasOwn(FLIGHT_DATA_SOURCES, source)) throw new Error('不支持的航班数据来源');
  if (!key?.trim()) throw new Error('请先在“数据与同步”配置飞常准 Key');
  const query = flightQuery(record);
  return flightCandidates(await new FlightConnector(key).flightStatus(query), query);
}
