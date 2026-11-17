export const JOURNEY_DATE_FIELDS=['departureDate','arrivalDate','actualDepartureDate','actualArrivalDate'];
const yearValid=year=>Number.isInteger(year)&&year>=1800&&year<=2200;
export const leapYear=year=>year%4===0&&(year%100!==0||year%400===0);
export const daysInYear=year=>leapYear(year)?366:365;

export function journeyDate(value) {
  if(value===undefined||value===null||value==='')return '';
  if(typeof value==='string'){
    if(/^\d{4}$/.test(value))return journeyDate({year:Number(value),dayOfYear:null});
    const match=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match)throw new Error('日期须填写年份与完整月日');
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    if(!yearValid(year)||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate())throw new Error('日期无效');
    return {year,dayOfYear:Math.round((Date.UTC(year,month-1,day)-Date.UTC(year,0,0))/86400000)};
  }
  if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['year','dayOfYear'].includes(key)))throw new Error('日期记录格式无效');
  return storedJourneyDate(value);
}
export function storedJourneyDate(value) {
  if(!value)return '';
  const {year,dayOfYear}=value;
  if(year!==null&&!yearValid(year))throw new Error('年份须为 1800 至 2200');
  if(dayOfYear!==null&&(!Number.isInteger(dayOfYear)||dayOfYear<1||dayOfYear>(year===null?366:daysInYear(year))))throw new Error('年内天数与年份不符');
  return year===null&&dayOfYear===null ? '' : {year,dayOfYear};
}
export function calendarDate(value) {
  const date=journeyDate(value);if(!date||date.year===null)return '';
  if(date.dayOfYear===null)return String(date.year);
  return new Date(Date.UTC(date.year,0,date.dayOfYear)).toISOString().slice(0,10);
}
export const sameDate=(a,b)=>JSON.stringify(journeyDate(a))===JSON.stringify(journeyDate(b));
export const fullDate=value=>{const date=journeyDate(value);return !!date&&date.year!==null&&date.dayOfYear!==null;};
export function monthDay(value) {return fullDate(value) ? calendarDate(value).slice(5) : '';}
export function dateWithYear(value,year) {
  const date=journeyDate(value);return journeyDate({year:year===''?null:Number(year),dayOfYear:date?.dayOfYear??null});
}
export function dateFromMonthDay(year,value) {
  if(!value)return year ? journeyDate({year:Number(year),dayOfYear:null}) : '';
  if(!year)throw new Error('请先填写年份');
  return journeyDate(`${year}-${value}`);
}
export function dateLabel(value,separator='.') {
  const date=journeyDate(value);if(!date)return '日期未知';
  if(date.year===null)return `第 ${date.dayOfYear} 天（年份未知）`;
  return calendarDate(date).replaceAll('-',separator);
}
