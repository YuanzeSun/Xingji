import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanText } from '../src/scan-engine.js';
import { parseText, parseSingleTicket } from '../src/importers.js';
import { parseRailOrder } from '../src/rail-order.js';
import { railTimeWords, railRouteAreas } from '../src/ocr-layout.js';

const screenshot = `订单详情
订单号:E000000001 下单时间:2026-11-01 12:30
北京南 G103 经停站 上海虹桥
08:00 历时5小时30分 13:30
发车时间:2026年11月15日 周日
示例旅客 中国居民身份证 成人票 ¥553.00
二等座 05车 08F号
已支付 退改说明
预订酒店 上海
11-15 入住 11-16 离店 ¥800
广告 G9999 火车接送`;

test('12306 screenshots prefer the travel date over order timestamps and ignore hotel ads and order IDs', () => {
  const [r] = parseScanText(screenshot, 'order.png');
  assert.equal(r.type, 'rail'); assert.equal(r.service, 'G103');
  assert.equal(r.origin, '北京南'); assert.equal(r.destination, '上海虹桥');
  assert.equal(calendarDate(r.departureDate), '2026-11-15'); assert.equal(r.departureTime, '08:00');
  assert.equal(r.arrivalTime, '13:30'); assert.equal(calendarDate(r.arrivalDate), '2026-11-15');
  assert.equal(r.passenger, '示例旅客'); assert.equal(r.carriage, '05'); assert.equal(r.seat, '08F');
  assert.equal(r.seatClass, '二等座'); assert.equal(r.price, '553.00'); assert.equal(r.ticketNumber, '');
  assert.equal(r.orderNumber, 'E000000001');
  assert.equal(r.sources[0].label, 'order.png'); assert.equal(r.provenance, 'reconstruction');
  assert.equal(calendarDate(parseText(screenshot)[0].departureDate), '2026-11-15');
});

test('labelled purchase details allow full-width punctuation, spaced Chinese, split values and numeric trains', () => {
  const [r] = parseScanText(`购 票 详 细 信 息
下单时间：２０２６／１１／０１ １２：３０
车次：１４６１
出 发 站：北 京 南
到 达 站：上 海 虹 桥
乘车日期：
２０２６／１１／１５
出发时间：２０：１０
到达时间：０８：２０
乘车人：示例旅客
身份证号：１１０１０１＊＊＊＊＊＊＊＊１２３４
车厢号：０２
座位号：０１８号下铺
席别：硬卧
票价：￥３００．５０`);
  assert.equal(r.service, '1461'); assert.equal(calendarDate(r.departureDate), '2026-11-15');
  assert.equal(r.origin, '北京南'); assert.equal(r.destination, '上海虹桥');
  assert.equal(r.departureTime, '20:10'); assert.equal(r.arrivalTime, '08:20');
  assert.equal(r.carriage, '02'); assert.equal(r.seat, '018下铺');
  assert.equal(r.identity, '110101********1234'); assert.equal(r.price, '300.50');
});

test('known OCR text from a screenshot recovers stations and the travel date while conflicting arrival digits stay blank', () => {
  const [r] = parseScanText(`订单号:E000000001 At /e]:2021-08-13
广州南 C7615 iets 顺德
08:38 历时8分 08:40
发车时间:2021年08月27日 周五
M' §. § #国居民身份证 ¥10
二等座 05车 01F号 详情
已支付 退改说明
预订酒店`);
  assert.equal(r.service, 'C7615'); assert.equal(r.origin, '广州南'); assert.equal(r.destination, '顺德');
  assert.equal(calendarDate(r.departureDate), '2021-08-27'); assert.equal(r.departureTime, '08:38');
  assert.equal(r.arrivalTime, '', 'contradictory OCR should not become a made-up arrival time');
  assert.equal(r.passenger, ''); assert.equal(r.price, '10');
});

test('missing travel dates and ambiguous station candidates are not filled from order metadata', () => {
  const [r] = parseScanText(`订单详情
订单号:E000000001 下单时间:2026-11-01 12:30
北京南 G103 上海虹桥 途经 济南西
08:00 13:30
二等座 05车08F号 已支付`);
  assert.equal(calendarDate(r.departureDate), ''); assert.equal(r.origin, ''); assert.equal(r.destination, '');
});

test('passengers on one order keep their names, seats and fares separate and share the route', () => {
  const text = `订单详情
订单号:E123456789
北京南 G103 上海虹桥
08:00 13:30
发车时间:2026-11-15
乘车人:示例甲
二等座 05车08F号 票价:¥553
已支付
乘车人:示例乙
二等座 06车12A号 票价:¥300
已支付
订单金额:¥853`;
  const records = parseScanText(text);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(r => [r.passenger, r.carriage, r.seat, r.price]), [['示例甲', '05', '08F', '553'], ['示例乙', '06', '12A', '300']]);
  assert.ok(records.every(r => r.service === 'G103' && calendarDate(r.departureDate) === '2026-11-15'));
  assert.ok(records.every(r => r.orderNumber === 'E123456789' && !r.ticketNumber));
  assert.equal(parseSingleTicket(text), null, 'camera acceptance must not silently collapse a family order');
});

test('coordinates recover left departure and right arrival times even when OCR reads the columns in reverse', () => {
  const tsv = [
    '5\t1\t1\t1\t1\t1\t400\t200\t110\t30\t90\tG103',
    '5\t1\t4\t1\t1\t1\t80\t200\t160\t35\t90\t北京南',
    '5\t1\t5\t1\t1\t1\t800\t200\t160\t35\t90\t上海虹桥',
    '5\t1\t2\t1\t1\t1\t800\t250\t160\t50\t90\t13:30',
    '5\t1\t3\t1\t1\t1\t80\t250\t160\t50\t90\t08:00'
  ].join('\n');
  assert.deepEqual(railTimeWords(tsv, 'G103').map(word => word.text), ['08:00', '13:30']);
  const text = screenshot.replace('08:00 历时5小时30分 13:30', '13:30 历时5小时30分 08:00').replace('北京南 G103 经停站 上海虹桥', '上海虹桥 G103 经停站 北京南');
  const [r] = parseScanText(text, 'order.png', { layout: tsv });
  assert.equal(r.departureTime, '08:00'); assert.equal(r.arrivalTime, '13:30');
  assert.equal(r.origin, '北京南'); assert.equal(r.destination, '上海虹桥');
});

test('overnight durations produce the arrival date only when the recognized times agree', () => {
  const [r] = parseScanText(`订单详情
广州 Z111 海口
21:30 历时11小时16分 08:46
发车时间:2026-11-15
硬卧 10车20号上铺 票价:¥261 已支付`);
  assert.equal(calendarDate(r.departureDate), '2026-11-15'); assert.equal(calendarDate(r.arrivalDate), '2026-11-16');
  assert.equal(r.seat, '20上铺');
});

test('split station words are joined without mixing in the large clock on the following row', () => {
  const layout = [
    '5\t1\t1\t1\t1\t1\t416\t281\t122\t32\t93\tC7615',
    '5\t1\t1\t1\t1\t2\t87\t262\t133\t43\t93\t广州',
    '5\t1\t1\t1\t1\t3\t195\t257\t27\t60\t88\t南',
    '5\t1\t1\t1\t1\t4\t902\t263\t88\t42\t95\t顺德',
    '5\t1\t1\t1\t2\t1\t88\t333\t185\t58\t89\t08:38',
    '5\t1\t1\t1\t2\t2\t803\t333\t186\t58\t87\t08:46'
  ].join('\n');
  assert.deepEqual(railRouteAreas(layout, 'C7615'), { origin: '广州南', destination: '顺德' });
});

test('other ticket formats continue through their own parsers', () => {
  assert.equal(parseRailOrder('G103 二等座 日期:2026-11-15'), null);
  assert.deepEqual(parseScanText('中国东方航空 登机牌 BOARDING PASS\n日期:2026-11-15 航班:MU5403\n出发:SHA 到达:TFU'), []);
});
