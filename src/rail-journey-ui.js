import {calendarDate,sameDate} from './journey-date.js';
import { escape as e } from './html.js';
import { railJourneyMatches, railJourneyRange, railTrainsetIds, isEmuModel } from './rail-journey.js';
import { isJourneyRecord } from './record-kind.js';

const source = (url, text, date) => `<p class="rail-journey-source"><a href="${url}" target="_blank" rel="noopener noreferrer">${text}：RailGo</a>${date ? ` · 查询于 ${e(new Date(date).toLocaleDateString('zh-CN'))}` : ''}</p>`;
const facts = entries => `<dl class="rail-facts">${entries.filter(([,value])=>value).map(([name,value])=>`<div${String(value).length>35 ? ' class="rail-fact-wide"' : ''}><dt>${e(name)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
const carriageNumber = value => String(Number(String(value || '').match(/\d+/)?.[0] || 0));
const localToday = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };

export function railReferenceNotice(record) {
  if (!railJourneyMatches(record) || !record.railJourney.query.referenceFor) return '';
  const { startDate, boardingDate, referenceFor } = record.railJourney.query;
  const referenceBoarding = sameDate(startDate, boardingDate) ? '' : ` · 参考上车日 ${calendarDate(boardingDate)}`;
  return `<strong>非乘车当日 · 仅供参考</strong><div>参考开行日 ${e(calendarDate(startDate))}${e(referenceBoarding)} · 乘车日 ${e(calendarDate(referenceFor))}</div>`;
}

function stockMarkup(record, journey, records) {
  const ids=railTrainsetIds(record), stocks=journey.trainsets.filter(stock=>ids.includes(stock.id));
  if (!stocks.length) return ids.length || isEmuModel(record.railModel) ? '<p class="rail-empty">暂未查到该车组的详细资料。</p>' : '';
  return `<section class="rail-journey-section"><div class="rail-section-heading"><h3>乘坐的车组</h3><span>${e(calendarDate(journey.query.startDate))} 始发${journey.coupling ? ' · 重联' : ''}</span></div><div class="rail-stock-grid">${stocks.map(stock=>{
    const encounters = records.filter(other=>other.id!==record.id && !other.deleted && isJourneyRecord(other) && calendarDate(other.departureDate) && calendarDate(other.departureDate) <= localToday() && railTrainsetIds(other).includes(stock.id)).sort((a,b)=>calendarDate(b.departureDate).localeCompare(calendarDate(a.departureDate))).slice(0,3);
    return `<article class="rail-stock-card"><h4>${e(stock.id)}</h4>${facts([['车型',[stock.model,stock.subModel].filter(Boolean).join(' · ')],['出厂年月',stock.manufactureMonth],['制造厂家',stock.manufacturer],['拖车制造厂家',stock.trailerManufacturer && stock.trailerManufacturer !== stock.manufacturer ? stock.trailerManufacturer : ''],['配属单位',stock.trainDepot],['运用所',stock.depot],['插座位置',stock.socket],['定制类型',stock.customType],['车型备注',stock.modelRemark],['车组备注',stock.carRemark]])}${stock.queriedAt ? `<p class="rail-snapshot">配属及设施资料：${e(new Date(stock.queriedAt).toLocaleDateString('zh-CN'))} 查询快照</p>` : ''}${encounters.length ? `<div class="rail-reunion"><strong>你也曾坐过这组车</strong>${encounters.map(other=>`<button type="button" class="text-button" data-action="view" data-id="${e(other.id)}">${e(calendarDate(other.departureDate))} · ${e(other.origin)} → ${e(other.destination)}</button>`).join('')}</div>` : ''}</article>`;
  }).join('')}</div>${source('https://api.railgo.dev/507418598e0','车组资料',journey.queriedAt)}</section>`;
}

function stopsMarkup(record,journey) {
  const base=journey.query.boardingDate,{from,to}=railJourneyRange(journey),hasDistance=journey.stops.every(stop=>Number.isFinite(stop.distanceKm));
  const time=(stop,side)=>stop[side+'Time'] ? (!sameDate(stop[side+'Date'],base) ? '<small>'+e(calendarDate(stop[side+'Date']))+'</small>' : '')+'<time>'+e(stop[side+'Time'])+'</time>' : '—';
  const rows=journey.stops.map((stop,index)=>'<tr class="'+(index>=from && index<=to ? 'rail-my-stop' : 'rail-outside-stop')+' '+(index===from || index===to ? 'rail-endpoint' : '')+'" data-my-segment="'+(index>=from && index<=to)+'"><th scope="row"><span>'+e(stop.station)+'</span>'+(index===from ? '<small>上车</small>' : index===to ? '<small>下车</small>' : '')+'</th><td>'+(index===0 ? '—' : time(stop,'arrival'))+'</td><td>'+(index===journey.stops.length-1 ? '—' : time(stop,'departure'))+'</td><td>'+(index===0 || index===journey.stops.length-1 || stop.stopMinutes===null ? '—' : e(stop.stopMinutes)+' 分钟')+'</td>'+(hasDistance ? '<td>'+e(stop.distanceKm)+'</td>' : '')+'</tr>').join('');
  return '<section class="rail-journey-section"><div class="rail-section-heading"><h3>列车全程</h3><span>'+e(journey.stops[0].station)+' → '+e(journey.stops.at(-1).station)+'</span></div><div class="rail-my-range"><strong>我的区间</strong><span>'+e(journey.query.origin)+' → '+e(journey.query.destination)+'</span><span>'+(to-from+1)+' / '+journey.stops.length+' 站'+(record.railMileage ? ' · '+e(record.railMileage)+' km' : '')+'</span></div><div class="rail-stops-scroll" tabindex="0" role="region" aria-label="完整列车行程与我的乘坐区间"><table class="rail-stops"><thead><tr><th>车站</th><th>到达</th><th>出发</th><th>停留</th>'+(hasDistance ? '<th>距始发 km</th>' : '')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+source('https://api.railgo.dev/479755220e0','列车时刻',journey.queriedAt)+'</section>';
}

function coachesMarkup(record, coaches) {
  if (!coaches || (!coaches.cars.length && !coaches.info.length)) return '';
  const selected = coaches.cars.find(car=>car.number && carriageNumber(car.number)===carriageNumber(record.carriage)) || coaches.cars[0];
  return `<section class="rail-journey-section"><div class="rail-section-heading"><h3>编组与车厢</h3><span>当前编组参考${coaches.model ? ' · '+e(coaches.model) : ''}</span></div>${coaches.cars.length ? `<div class="rail-coaches" tabindex="0" role="group" aria-label="当前列车车厢">${coaches.cars.map((car,index)=>`<button type="button" data-rail-coach="${index}" aria-pressed="${car===selected}" class="rail-coach${car.number && carriageNumber(car.number)===carriageNumber(record.carriage) ? ' ticket-carriage' : ''}"><strong>${e(car.number ? car.number+'车' : car.name)}</strong><span>${e(car.number ? car.name.replace(/^\d{1,2}车\s*/,'') : '')}</span>${car.number && carriageNumber(car.number)===carriageNumber(record.carriage) ? '<small>你的车厢</small>' : ''}</button>`).join('')}</div><figure class="rail-coach-picture"><img data-rail-coach-image src="${e(selected.url)}" alt="${e(selected.name)}" loading="lazy" referrerpolicy="no-referrer"/><figcaption data-rail-coach-caption>${e(selected.name)}</figcaption></figure>` : ''}${facts(coaches.info.map(item=>[item.name,item.value]))}${source('https://api.railgo.dev/479766603e0','当前车厢资料',coaches.queriedAt)}</section>`;
}

export function railJourneyMarkup(record, records = []) {
  if (!railJourneyMatches(record)) return '';
  const journey = record.railJourney;
  return `<div class="rail-journey">${stopsMarkup(record,journey)}${stockMarkup(record,journey,records)}${coachesMarkup(record,journey.coaches)}</div>`;
}

export function bindRailJourney(container, getRecord) {
  const click = event => {
    const button = event.target.closest('[data-rail-coach]');
    if (!button || !container.contains(button)) return;
    const record = getRecord(), car = railJourneyMatches(record) && record.railJourney.coaches?.cars[Number(button.dataset.railCoach)];
    if (!car) return;
    const section = button.closest('.rail-journey-section');
    section.querySelectorAll('[data-rail-coach]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    const image = section.querySelector('[data-rail-coach-image]'); image.src=car.url; image.alt=car.name;
    section.querySelector('[data-rail-coach-caption]').textContent=car.name;
  };
  container.addEventListener('click',click);
  return ()=>container.removeEventListener('click',click);
}
