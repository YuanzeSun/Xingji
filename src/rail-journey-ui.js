import {calendarDate,sameDate} from './journey-date.js';
import { escape as e } from './html.js';
import { railJourneyMatches, railJourneyRange, railTrainsetIds, isEmuModel, RAIL_TIMETABLE_REFERENCES } from './rail-journey.js';
import { isJourneyRecord } from './record-kind.js';

const source = (url, text, date, name = 'RailGo', also) => `<p class="rail-journey-source"><a href="${url}" target="_blank" rel="noopener noreferrer">${text}：${name}</a>${also ? ` · <a href="${also.url}" target="_blank" rel="noopener noreferrer">${also.name}</a>` : ''}${date ? ` · 查询于 ${e(new Date(date).toLocaleDateString('zh-CN'))}` : ''}</p>`;
const facts = entries => `<dl class="rail-facts">${entries.filter(([,value])=>value).map(([name,value])=>`<div${String(value).length>35 ? ' class="rail-fact-wide"' : ''}><dt>${e(name)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
const carriageNumber = value => Number(/^\s*(\d+)(?:车厢?)?\s*$/.exec(value || '')?.[1]) || 0;
const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };

export function railReferenceNotice(record) {
  if (!railJourneyMatches(record)) return '';
  const { startDate, boardingDate, referenceFor } = record.railJourney.query;
  if (!referenceFor) return '';
  const referenceBoarding = sameDate(startDate, boardingDate) ? '' : ` · 参考上车日 ${calendarDate(boardingDate)}`;
  return `<strong>非乘车当日 · 仅供参考</strong><div>参考开行日 ${e(calendarDate(startDate))}${e(referenceBoarding)} · 乘车日 ${e(calendarDate(referenceFor))}</div>`;
}

function stockMarkup(record, journey, records) {
  const ids=railTrainsetIds(record), stocks=journey.trainsets.filter(stock=>ids.includes(stock.id));
  if (!stocks.length) return ids.length || isEmuModel(record.railModel) ? '<p class="rail-empty">暂未查到该车组的详细资料。</p>' : '';
  const historical = !!journey.timetableReference;
  return `<section class="rail-journey-section"><div class="rail-section-heading"><h3>乘坐的车组</h3><span>${e(calendarDate(journey.query.startDate))} 始发${journey.coupling ? ' · 重联' : ''}</span></div><div class="rail-stock-grid">${stocks.map(stock=>{
    const encounters = records.filter(other=>other.id!==record.id && !other.deleted && isJourneyRecord(other) && calendarDate(other.departureDate) && calendarDate(other.departureDate) <= localToday() && railTrainsetIds(other).includes(stock.id)).sort((a,b)=>calendarDate(b.departureDate).localeCompare(calendarDate(a.departureDate))).slice(0,3);
    return `<article class="rail-stock-card"><h4>${e(stock.id)}</h4>${facts([['车型',[stock.model,stock.subModel].filter(Boolean).join(' · ')],['出厂年月',stock.manufactureMonth],['制造厂家',stock.manufacturer],['拖车制造厂家',stock.trailerManufacturer && stock.trailerManufacturer !== stock.manufacturer ? stock.trailerManufacturer : ''],['配属单位',stock.trainDepot],['运用所',stock.depot],['插座位置',stock.socket],['定制类型',stock.customType],['车型备注',stock.modelRemark],['车组备注',stock.carRemark]])}${stock.queriedAt ? `<p class="rail-snapshot">配属及设施资料：${e(new Date(stock.queriedAt).toLocaleDateString('zh-CN'))} 查询快照</p>` : ''}${encounters.length ? `<div class="rail-reunion"><strong>你也曾坐过这组车</strong>${encounters.map(other=>`<button type="button" class="text-button" data-action="view" data-id="${e(other.id)}">${e(calendarDate(other.departureDate))} · ${e(other.origin)} → ${e(other.destination)}</button>`).join('')}</div>` : ''}</article>`;
  }).join('')}</div>${historical ? source('https://crh.lihugang.top/docs/api/history-train','车组资料',journey.queriedAt,'Open CRH Tracker') : source('https://api.railgo.dev/507418598e0','车组资料',journey.queriedAt)}</section>`;
}

function stopsMarkup(record,journey) {
  const base=journey.query.boardingDate,{from,to}=railJourneyRange(journey),hasDistance=journey.stops.every(stop=>Number.isFinite(stop.distanceKm));
  const timetableSource = RAIL_TIMETABLE_REFERENCES[journey.timetableReference?.provider] || { name: 'RailGo', url: 'https://api.railgo.dev/479755220e0' };
  const additionalSource = RAIL_TIMETABLE_REFERENCES[journey.timetableReference?.alsoFrom];
  const time=(stop,side)=>stop[side+'Time'] ? (!sameDate(stop[side+'Date'],base) ? '<small>'+e(calendarDate(stop[side+'Date']))+'</small>' : '')+'<time>'+e(stop[side+'Time'])+'</time>' : '—';
  const rows=journey.stops.map((stop,index)=>'<tr class="'+(index>=from && index<=to ? 'rail-my-stop' : 'rail-outside-stop')+' '+(index===from || index===to ? 'rail-endpoint' : '')+'" data-my-segment="'+(index>=from && index<=to)+'"><th scope="row"><span>'+e(stop.station)+'</span>'+(index===from ? '<small>上车</small>' : index===to ? '<small>下车</small>' : '')+'</th><td>'+(index===0 ? '—' : time(stop,'arrival'))+'</td><td>'+(index===journey.stops.length-1 ? '—' : time(stop,'departure'))+'</td><td>'+(index===0 || index===journey.stops.length-1 || stop.stopMinutes===null ? '—' : e(stop.stopMinutes)+' 分钟')+'</td>'+(hasDistance ? '<td>'+e(stop.distanceKm)+'</td>' : '')+'</tr>').join('');
  return '<section class="rail-journey-section"><div class="rail-section-heading"><h3>列车全程</h3><span>'+e(journey.stops[0].station)+' → '+e(journey.stops.at(-1).station)+'</span></div><div class="rail-my-range"><strong>我的区间</strong><span>'+e(journey.query.origin)+' → '+e(journey.query.destination)+'</span><span>'+(to-from+1)+' / '+journey.stops.length+' 站'+(record.railMileage ? ' · '+e(record.railMileage)+' km' : '')+'</span></div><div class="rail-stops-scroll" tabindex="0" role="region" aria-label="完整列车行程与我的乘坐区间"><table class="rail-stops"><thead><tr><th>车站</th><th>到达</th><th>出发</th><th>停留</th>'+(hasDistance ? '<th>距始发 km</th>' : '')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+source(timetableSource.url,'列车时刻',journey.queriedAt,timetableSource.name,additionalSource)+'</section>';
}

function coachesMarkup(record, coaches) {
  if (!coaches || (!coaches.cars.length && !coaches.info.length)) return '';
  const number = carriageNumber(record.carriage);
  const matches = number ? coaches.cars.filter(car => carriageNumber(car.number) === number) : [];
  const selected = matches.length === 1 ? matches[0] : null;
  const formation = coaches.cars.length ? `<div class="rail-coaches" tabindex="0" role="list" aria-label="当前列车车厢">${coaches.cars.map(car => `
    <div role="listitem" class="rail-coach${car === selected ? ' ticket-carriage' : ''}">
      <strong>${e(car.number ? car.number + '车' : car.name)}</strong>
      ${car.number ? `<span>${e(car.name.replace(/^\d{1,2}车\s*/, ''))}</span>` : ''}
      ${car === selected ? '<small>你的车厢</small>' : ''}
    </div>`).join('')}</div>` : '';
  const picture = selected?.url ? `<figure class="rail-coach-picture">
    <img data-rail-coach-image src="${e(selected.url)}" alt="${e(selected.name)}" loading="lazy" referrerpolicy="no-referrer" />
    <figcaption>${e(selected.name)}</figcaption>
  </figure>` : '';
  return `<section class="rail-journey-section">
    <div class="rail-section-heading"><h3>编组与车厢</h3><span>当前编组参考${coaches.model ? ' · ' + e(coaches.model) : ''}</span></div>
    ${formation}${picture}${facts(coaches.info.map(item => [item.name, item.value]))}
    ${source('https://api.railgo.dev/479766603e0', '当前车厢资料', coaches.queriedAt)}
  </section>`;
}

export function railJourneyMarkup(record, records = []) {
  if (!railJourneyMatches(record)) return '';
  const journey = record.railJourney;
  return `<div class="rail-journey">${stopsMarkup(record,journey)}${stockMarkup(record,journey,records)}${coachesMarkup(record,journey.coaches)}</div>`;
}
