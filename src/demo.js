import {createRecord,FIELDS} from './model.js';
import {DEMO_TICKET_CODE} from './demo-code.js';
import {DEMO_RAIL_DETAILS} from './data/demo-rail.js';
import {createBoardingCode} from './bcbp.js';
import {railCompletion,shiftRailDate} from './rail-lookup-model.js';
import {LOOKUP_FIELDS} from './lookup-values.js';
import {markFieldSources} from './field-sources.js';

const localToday=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const verifiedAt='2026-11-17T00:00:00.000Z';

function railExample(record){
  const reference=structuredClone(DEMO_RAIL_DETAILS[record.service]);
  const days=Math.round((Date.parse(record.departureDate)-Date.parse(reference.query.boardingDate))/86400000);
  const shift=value=>value ? shiftRailDate(value,days) : '';
  reference.query.date=shift(reference.railJourney.query.startDate).replaceAll('-','');
  reference.query.boardingDate=record.departureDate;
  reference.arrivalDate=shift(reference.arrivalDate);
  reference.railJourney.query.startDate=shift(reference.railJourney.query.startDate);
  reference.railJourney.query.boardingDate=record.departureDate;
  for(const stop of reference.railJourney.stops){stop.arrivalDate=shift(stop.arrivalDate);stop.departureDate=shift(stop.departureDate);}
  reference.railJourney.access=[{station:record.origin,date:record.departureDate,gates:[record.gate+'检票口'],platform:record.railPlatform}];
  for(const stock of reference.railJourney.trainsets)Object.assign(stock,{
    customType:'运营配置示例',
    modelRemark:`示例车型备注：${stock.model} 型动车组的补充资料。`,
    carRemark:'示例车组备注：记录曾乘车组的补充说明。'
  });
  const values=railCompletion(record,reference);
  return {...values,railPowerSupply:values.railPowerSupply || (record.service==='Z83' ? 'AC380V' : 'AC25KV'),railMileage:values.railMileage || ({G7602:'256',Z83:'1531'}[record.service]),
    lookupValues:Object.fromEntries(Object.entries(values).filter(([key,value])=>LOOKUP_FIELDS.includes(key)&&value)),
    fieldSources:Object.fromEntries(Object.entries(values).filter(([,value])=>value).map(([key])=>[key,'railgo']))};
}

export function demoRecords(today=localToday()){
  const recent=days=>shiftRailDate(today,-days);
  const rows=[
    {id:'demo-1',type:'rail',template:'rail-receipt',departureDate:recent(1),origin:'北京南',destination:'南京南',service:'G21',carriage:'05',seat:'08F',seatClass:'二等座',price:'503.0',issuer:'北京南',gate:'16A',railPlatform:'8'},
    {id:'demo-2',type:'flight',template:'air-boarding-pass',departureDate:recent(1),departureTime:'09:15',arrivalTime:'12:30',boardingTime:'08:35',actualDepartureTime:'09:23',actualArrivalTime:'12:37',origin:'上海虹桥',destination:'成都双流',originCode:'SHA',destinationCode:'CTU',service:'MU5403',airline:'中国东方航空',seat:'32A',seatClass:'Y',terminal:'T2',gate:'D21',aircraft:'A321-200',aircraftRegistration:'B-1813',flightDistance:'1667',pnr:'DEMO01',actualBoardingTime:'08:41',baggageTagNumbers:'7810000101',checkedBaggageCount:'1',freeBaggageAllowance:'20K',frequentFlyerCarrier:'MU',frequentFlyerNumber:'000012345678',marketingCarrier:'MU',price:'860.00',ticketNumber:'7810000000001'},
    {id:'demo-3',type:'rail',template:'rail-blue',departureDate:'2018-10-01',origin:'杭州东',destination:'南京南',service:'G7602',carriage:'03',seat:'12A',seatClass:'二等座',price:'117.5',issuer:'杭州东',gate:'7',railPlatform:'7',provenance:'reconstruction'},
    {id:'demo-4',type:'rail',template:'rail-red-classic',departureDate:'2014-07-12',origin:'北京',destination:'齐齐哈尔',service:'Z83',carriage:'09',seat:'015号下铺',seatClass:'硬卧',price:'363.0',issuer:'北京',gate:'2',railPlatform:'5',provenance:'reconstruction'},
    {id:'demo-5',type:'rail',template:'rail-receipt',departureDate:recent(2),origin:'广州南',destination:'深圳北',service:'G6203',carriage:'07',seat:'06C',seatClass:'二等座',price:'74.5',issuer:'广州南',gate:'B18',railPlatform:'18'},
    {id:'demo-6',type:'flight',template:'air-boarding-pass',departureDate:recent(3),departureTime:'08:40',arrivalTime:'12:50',boardingTime:'08:00',actualDepartureTime:'08:48',actualArrivalTime:'12:55',origin:'北京首都',destination:'东京羽田',originCode:'PEK',destinationCode:'HND',service:'CA181',airline:'中国国际航空',seat:'24K',seatClass:'Y',terminal:'T3',gate:'E23',aircraft:'A330-300',aircraftRegistration:'B-0002',flightDistance:'2100',pnr:'DEMO02',actualBoardingTime:'08:06',baggageTagNumbers:'9990000201–9990000202',checkedBaggageCount:'2',freeBaggageAllowance:'2PC',frequentFlyerCarrier:'CA',frequentFlyerNumber:'000087654321',marketingCarrier:'CA',price:'2680.00',ticketNumber:'9990000000002',passenger:'EXAMPLE/TRAVELER',identity:'P00000000'},
    {id:'demo-7',type:'rail',template:'rail-red',departureDate:'2017-09-10',origin:'北京南',destination:'天津',service:'C2021',carriage:'01',seat:'02A',seatClass:'二等座',price:'57.0',issuer:'北京南',gate:'18',railPlatform:'9',provenance:'reconstruction'}
  ];
  const marks={'demo-1':[{text:'网',shape:'circle'}],'demo-3':[{text:'网',shape:'plain'}],'demo-4':[{text:'网',shape:'circle'}],'demo-5':[{text:'网',shape:'circle'},{text:'学',shape:'circle'}],'demo-7':[{text:'网',shape:'plain'}]};
  return rows.map((row,index)=>{
    const values={passenger:'示例旅客',identity:'11010119900101****',orderNumber:`EX0000000${index+1}`,ticketNumber:`X00000${index+1}`,saleCode:`00000000000000000000${index+1}`,ticketMarks:marks[row.id] || [],provenance:'commemorative',createdAt:verifiedAt,updatedAt:verifiedAt,...row};
    const source={kind:'demo',label:'示例行程；班次与线路采用公开资料，旅客、票号及部分字段为示例填充',at:verifiedAt};
    values.fieldSources=Object.fromEntries(Object.keys(values).filter(key=>FIELDS.includes(key)).map(key=>[key,'default']));
    if(row.type==='rail'){
      const details=railExample(values);
      Object.assign(values,details,{fieldSources:{...values.fieldSources,...details.fieldSources}});
      values.ticketCode=DEMO_TICKET_CODE;
      values.sources=[source,{kind:'rail-lookup',label:'RailGo 列车与铁路线路快照（示例日期用于展示）',at:values.railJourney.queriedAt}];
    }else{
      values.arrivalDate=values.actualDepartureDate=values.actualArrivalDate=values.departureDate;
      values.flightStatus='normal';
      values.boardingCode=createBoardingCode({passenger:values.passenger==='示例旅客' ? 'SHILI/LVKE' : values.passenger,pnr:values.pnr,origin:values.originCode,destination:values.destinationCode,carrier:values.service.slice(0,2),flightNumber:values.service.slice(2),date:values.departureDate,cabin:values.seatClass,seat:values.seat,sequence:String(42+index),status:'1',electronic:''});
      values.boardingCodeSource='generated';values.fieldSources.boardingCode='generated';
      values.sources=[source,{kind:'reference',label:row.service==='MU5403' ? '航班核对：东方航空 MU5403，上海虹桥—成都双流' : '航班核对：中国国际航空 CA181，北京首都—东京羽田',at:verifiedAt}];
    }
    markFieldSources(values,FIELDS.filter(key=>!values.fieldSources[key]),'default');
    return createRecord(values);
  });
}
