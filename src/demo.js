import {createRecord,FIELDS} from './model.js';
import {journeyDate} from './journey-date.js';
import {DEMO_TICKET_CODE} from './demo-code.js';
import {DEMO_RAIL_DETAILS} from './data/demo-rail.js';
import {createBoardingCode} from './bcbp.js';
import {railCompletion,shiftRailDate} from './rail-lookup-model.js';
import {LOOKUP_FIELDS} from './lookup-values.js';
import {markFieldSources} from './field-sources.js';
import {flightTrackRequest} from './flight-track.js';

const localToday=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const verifiedAt='2026-11-17T00:00:00.000Z';

function railExample(record){
  const reference=structuredClone(DEMO_RAIL_DETAILS[record.service]);
  const days=Math.round((Date.parse(record.departureDate)-Date.parse(reference.query.boardingDate))/86400000);
  const shift=value=>value ? shiftRailDate(value,days) : '';
  reference.query.date=shift(reference.railJourney.query.startDate).replaceAll('-','');
  reference.query.boardingDate=record.departureDate;
  reference.arrivalDate=shift(reference.arrivalDate);
  reference.railJourney.query.startDate=journeyDate(shift(reference.railJourney.query.startDate));
  reference.railJourney.query.boardingDate=journeyDate(record.departureDate);
  for(const stop of reference.railJourney.stops){stop.arrivalDate=journeyDate(shift(stop.arrivalDate));stop.departureDate=journeyDate(shift(stop.departureDate));}
  reference.railJourney.access=[{station:record.origin,date:journeyDate(record.departureDate),gates:[record.gate+'检票口'],platform:record.railPlatform}];
  for(const stock of reference.railJourney.trainsets)Object.assign(stock,{
    customType:'运营配置示例',
    modelRemark:`示例车型备注：${stock.model} 型动车组的补充资料。`,
    carRemark:'示例车组备注：记录曾乘车组的补充说明。'
  });
  const values=railCompletion(record,reference);
  if(values.arrivalDate)values.arrivalDate=journeyDate(values.arrivalDate);
  return {...values,railPowerSupply:values.railPowerSupply || (record.service==='Z83' ? 'AC380V' : 'AC25KV'),railMileage:values.railMileage || ({G7602:'256',Z83:'1531'}[record.service]),
    lookupValues:Object.fromEntries(Object.entries(values).filter(([key,value])=>LOOKUP_FIELDS.includes(key)&&value)),
    fieldSources:Object.fromEntries(Object.entries(values).filter(([,value])=>value).map(([key])=>[key,'railgo']))};
}

export function demoRecords(today=localToday()){
  const recent=days=>shiftRailDate(today,-days);
  const domesticFlight = {
    type: 'flight', template: 'air-boarding-pass', origin: '上海虹桥', destination: '成都双流', originCode: 'SHA', destinationCode: 'CTU',
    airline: '中国东方航空', marketingCarrier: 'MU', departureTime: '09:15', arrivalTime: '12:30', boardingTime: '08:35',
    actualDepartureTime: '09:23', actualArrivalTime: '12:37', actualBoardingTime: '08:41', flightDistance: '1667',
    seat: '32A', seatClass: 'Y', terminal: 'T2', gate: 'D21', price: '860.00',
    checkedBaggageCount: '1', freeBaggageAllowance: '20K', frequentFlyerCarrier: 'MU', frequentFlyerNumber: '000012345678'
  };
  const boeingExamples = [['737-8Q8', 'B-DEMO1'], ['737-800', 'B-DEMO1'], ['737-8', 'B-DEMO3']].map(([aircraft, aircraftRegistration], index) => ({
    ...domesticFlight, id: `demo-${8 + index}`, service: `MU990${1 + index}`, departureDate: recent(4 + index),
    aircraft, aircraftRegistration, pnr: `DEMO0${3 + index}`,
    baggageTagNumbers: `781000010${2 + index}`, ticketNumber: `781000000000${2 + index}`
  }));
  const g21 = {id:'demo-1',type:'rail',template:'rail-receipt',departureDate:recent(1),origin:'北京南',destination:'南京南',service:'G21',carriage:'05',seat:'08F',seatClass:'二等座',price:'503.0',issuer:'北京南',railShowIssuer:true,gate:'16A',railPlatform:'8'};
  const rows=[
    g21,
    {...domesticFlight,id:'demo-2',departureDate:recent(1),service:'MU5403',aircraft:'A321-200',aircraftRegistration:'B-1813',pnr:'DEMO01',baggageTagNumbers:'7810000101',ticketNumber:'7810000000001'},
    {id:'demo-3',type:'rail',template:'rail-blue',departureDate:'2018-10-01',origin:'杭州东',destination:'南京南',service:'G7602',carriage:'03',seat:'12A',seatClass:'二等座',price:'117.5',issuer:'杭州东',gate:'7',railPlatform:'7',provenance:'reconstruction'},
    {id:'demo-4',type:'rail',template:'rail-red-classic',departureDate:'2014-07-12',origin:'北京',destination:'齐齐哈尔',service:'Z83',carriage:'09',seat:'015号下铺',seatClass:'硬卧',price:'363.0',issuer:'北京',gate:'2',railPlatform:'5',provenance:'reconstruction'},
    {id:'demo-5',type:'rail',template:'rail-receipt',departureDate:recent(2),origin:'广州南',destination:'深圳北',service:'G6203',carriage:'07',seat:'06C',seatClass:'二等座',price:'74.5',issuer:'广州南',gate:'B18',railPlatform:'18'},
    {id:'demo-6',type:'flight',template:'air-boarding-pass',departureDate:recent(3),departureTime:'08:40',arrivalTime:'12:50',boardingTime:'08:00',actualDepartureTime:'08:48',actualArrivalTime:'12:55',origin:'北京首都',destination:'东京羽田',originCode:'PEK',destinationCode:'HND',service:'CA181',airline:'中国国际航空',seat:'24K',seatClass:'Y',terminal:'T3',gate:'E23',aircraft:'A330-343',aircraftRegistration:'B-0002',flightDistance:'2100',pnr:'DEMO02',actualBoardingTime:'08:06',baggageTagNumbers:'9990000201–9990000202',checkedBaggageCount:'2',freeBaggageAllowance:'2PC',frequentFlyerCarrier:'CA',frequentFlyerNumber:'000087654321',marketingCarrier:'CA',price:'2680.00',ticketNumber:'9990000000002',passenger:'EXAMPLE/TRAVELER',identity:'P00000000'},
    {id:'demo-7',type:'rail',template:'rail-red',departureDate:'2017-09-10',origin:'北京南',destination:'天津',service:'C2021',carriage:'01',seat:'02A',seatClass:'二等座',price:'57.0',issuer:'北京南',gate:'18',railPlatform:'9',provenance:'reconstruction'},
    ...boeingExamples,
    {...g21,id:'demo-11',departureDate:recent(7),seat:'10A'}
  ];
  const marks={'demo-1':[{text:'网',shape:'circle'}],'demo-3':[{text:'网',shape:'plain'}],'demo-4':[{text:'网',shape:'circle'}],'demo-5':[{text:'网',shape:'circle'},{text:'学',shape:'circle'}],'demo-7':[{text:'网',shape:'plain'}]};
  return rows.map((row,index)=>{
    const serial = String(index + 1);
    const values={passenger:'示例旅客',identity:'110101199001010000',orderNumber:'EX'+serial.padStart(8,'0'),provenance:'commemorative',createdAt:verifiedAt,updatedAt:verifiedAt,...row};
    const syntheticFlight = boeingExamples.includes(row);
    const label = syntheticFlight ? '虚构航班与执飞记录，用于展示机型统计' : '示例行程，部分班次及线路引用公开资料';
    values.sources=[{kind:'demo',label,at:verifiedAt}];
    values.fieldSources={};
    if(row.type==='rail'){
      values.ticketNumber='X'+serial.padStart(6,'0');
      values.saleCode=serial.padStart(21,'0');
      values.ticketMarks=marks[row.id] || [];
      Object.assign(values,railExample(values));
      values.ticketCode=DEMO_TICKET_CODE;
      values.sources.push({kind:'rail-lookup',label:'RailGo 列车与铁路线路快照（示例日期用于展示）',at:values.railJourney.queriedAt});
    }else{
      values.arrivalDate=values.actualDepartureDate=values.actualArrivalDate=values.departureDate;
      values.flightStatus='normal';
      if (row.service === 'CA181') values.flightTrack = {
        flightStr: flightTrackRequest(values), queriedAt: verifiedAt,
        segments: [[[116.59, 40.08], [116.76, 40.04], [117.14, 39.97], [118.61, 39.53], [120.21, 39.51],
          [121.67, 38.66], [123.31, 37.18], [126.1, 35.7], [129.09, 34.68], [132.5, 34.11], [135.1, 34.43],
          [137.24, 34.65], [138.19, 34.68], [139.35, 34.92], [139.78, 35.55]]]
      };
      values.boardingCode=createBoardingCode({passenger:values.passenger==='示例旅客' ? 'SHILI/LVKE' : values.passenger,pnr:values.pnr,origin:values.originCode,destination:values.destinationCode,carrier:values.service.slice(0,2),flightNumber:values.service.slice(2),date:values.departureDate,cabin:values.seatClass,seat:values.seat,sequence:String(42+index),status:'1',electronic:''});
      values.boardingCodeSource='generated';values.boardingLegIndex='0';values.fieldSources.boardingCode='generated';
      if (!syntheticFlight) values.sources.push({kind:'reference',label:`航班参考：${values.airline} ${values.service}，${values.origin}—${values.destination}`,at:verifiedAt});
    }
    markFieldSources(values,FIELDS.filter(key=>!values.fieldSources[key]),'default');
    return createRecord(values);
  });
}
