import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanText, railPhotoChanges } from '../src/scan-engine.js';
import { archive, createRecord, readArchive } from '../src/model.js';
import { reviewTicketImport } from '../src/ticket-import-review.js';
import { refineRailService, refineRailTemplate, preferEnhancedRailRead } from '../src/rail-ocr.js';
import { railPaperFromPixels } from '../src/rail-template.js';
import { printedRailNumber, railFareFromLine, railSeatFromLine } from '../src/rail-ticket.js';
import { validateTicketForm } from '../src/ticket-form.js';

const layout = entries => '1\t1\t0\t0\t0\t0\t0\t0\t1000\t630\t-1\t\n' + entries.map(([text,x,y,w,h,confidence=90],i) => `5\t1\t1\t1\t1\t${i+1}\t${x}\t${y}\t${w}\t${h}\t${confidence}\t${text}`).join('\n');
const picture = (service='D3759') => `X000001\n柳州站 ${service} 来宾北站\nLiuzhou Laibinbei\n2023年05月26日 15:06开 03车15F号\n￥24.0元 二等座\n仅供报销使用\n报销凭证 遗失不补`;

test('rail paper colour distinguishes red and blue, while the printed reimbursement notice takes priority', async () => {
  const paper = color => railPaperFromPixels(Uint8Array.from(Array.from({ length: 32 }, () => color).flat()));
  const red = paper([234, 183, 173, 255]), blue = paper([173, 228, 240, 255]);
  const plain = picture().split('\n仅供')[0], printable = plain + '\n限乘当日当次车';
  const template = (text, paperColor) => parseScanText(text, 'photo', { railImage: true, paperColor })[0].template;
  assert.equal(template(printable, red), 'rail-red');
  assert.equal(template(printable.replace('2023年', '2014年'), red), 'rail-red-classic');
  assert.equal(template(printable, blue), 'rail-blue');
  assert.equal(template(picture(), blue), 'rail-receipt');
  assert.equal(template(picture() + '\n退 票 费', blue), 'rail-refund-receipt');
  const data = { text: plain, tsv: '' };
  await refineRailTemplate({
    setParameters: async () => {},
    recognize: async () => ({ data: { text: '仅供报 销使用', confidence: 85 } })
  }, { width: 1000, height: 630 }, data, blue);
  assert.equal(template(data.text, blue), 'rail-receipt');
});

test('a photographed red ticket switches the draft template when the paper has a faint warm tint', () => {
  const pale = Uint8Array.from(Array.from({ length: 32 }, () => [208, 201, 200, 255]).flat());
  assert.equal(railPaperFromPixels(pale), '');
  const paperColor = railPaperFromPixels(pale, { faint: true });
  const redText = picture().split('\n仅供')[0] + '\n限乘当日当次车';
  const draft = createRecord({ template: 'rail-blue', fieldSources: { template: 'manual' }, lockedFields: ['template'] });
  const [red] = parseScanText(redText, 'photo', { paperColor });
  const [unknown] = parseScanText(redText, 'photo');
  assert.equal(railPhotoChanges(draft, red).template, 'rail-red');
  assert.equal(railPhotoChanges(draft, unknown).template, undefined);
  assert.equal(railPhotoChanges(draft, parseScanText(picture(), 'photo', { paperColor })[0]).template, 'rail-receipt');
});

test('historical red stock distinguishes the barcode, anonymous QR and named QR periods', () => {
  const text = date => `X000001\n北京站 K123 济南站\nBeijing Jinan\n${date} 09:12开 01车08号\n￥53.0元 硬座\n限乘当日当次车`;
  const parse = raw => parseScanText(raw, 'photo', { paperColor: 'red' })[0];
  assert.equal(parse(text('2008年10月03日')).template, 'rail-red-barcode');
  assert.equal(parse(text('2010年10月03日')).template, 'rail-red-qr');
  assert.equal(parse(text('2011年10月03日') + '\n1101011990****1234 示例旅客').template, 'rail-red-classic');
  assert.equal(parse(text('2015年03月03日')).template, 'rail-red-classic');
  assert.equal(parse(text('2015年07月03日') + '\n买票请到12306').template, 'rail-red');
  assert.equal(parse(text('2015年08月03日')).template, 'rail-red');
});

test('mobile supplement OCR keeps the printed date, ticket numbers and additional charges', () => {
  const [supplement] = parseScanText(`7000001
天津站 K608 张家口南站
2015年07月01日 加1车19号中铺
¥99.5元 硬卧
限乘当日当次车 中途下车失效
1101011990****1234 事由：客快硬卧
含手续费：5.0元 加收：0.0元
T1801000010701A000000 沈阳客运段补`);
  assert.deepEqual([supplement.template, supplement.origin, supplement.destination, supplement.service],
    ['rail-supplement', '天津', '张家口南', 'K608']);
  assert.deepEqual([supplement.departureTime, supplement.identity, supplement.carriage, supplement.seat], ['', '', '加1', '19号中铺']);
  assert.deepEqual([supplement.price, supplement.ticketNumber, supplement.saleCode, supplement.issuer],
    ['99.5', '7000001', 'T1801000010701A000000', '沈阳客运段']);
  const changes = railPhotoChanges(createRecord(), supplement);
  assert.deepEqual([changes.railSupplementReason, changes.railSupplementFee, changes.railSupplementSurcharge], ['客快硬卧', '5.0', '0.0']);
  assert.doesNotThrow(() => validateTicketForm(supplement));
  const ordinary = createRecord({ ...supplement, id:'regular-ticket', template:'rail-red' });
  const matches = reviewTicketImport([ordinary, supplement], { ...supplement, id:'repeated-scan' });
  assert.deepEqual(matches.map(match => match.record.id), [supplement.id]);
  assert.equal(readArchive(archive([ordinary, supplement])).find(r => r.template === 'rail-supplement').railSupplementFee, '5.0');
});

test('rail fares retain cents and reject lookalike years, percentages and additional charges', () => {
  assert.equal(railFareFromLine('羊 ４１ · ５０ 元 二等座'), '41.50');
  assert.equal(railFareFromLine(' 8.5 ', { regional: true }), '8.5');
  for (const printed of ['2024', '08车10A号', '加收0.0元', '15%', 'Y073006', 'Y0730']) {
    assert.equal(railFareFromLine(printed, { regional: true }), '', printed);
  }
  const original = picture().replace('￥24.0元', '￥24.00元');
  assert.equal(parseScanText(original + '\n加收 0.0 元')[0].price, '24.00');
  for (const mark of ['JM', 'JN']) {
    assert.equal(printedRailNumber('10010300351001S042775 ' + mark, true), '10010300351001S042775');
    assert.equal(printedRailNumber('10010300351001S042775' + mark, true), '10010300351001S042775');
  }
});

test('rail OCR can re-read a missing train directly between the station headings', async () => {
  const data = { text: picture('???'), tsv: layout([['Liuzhou',150,140,140,30],['Laibinbei',710,140,170,30]]) };
  await refineRailService({
    setParameters: async () => {},
    recognize: async (_image, { rectangle }) => {
      assert.ok(rectangle.left > 230 && rectangle.left + rectangle.width < 745);
      return { data: { text: 'D3759', confidence: 90 } };
    }
  }, {}, data);
  assert.equal(parseScanText(data.text, 'photo', { layout: data.tsv })[0].service, 'D3759');
});

test('printed rail tickets remain one rail record when serial numbers resemble flight codes', () => {
  const text = 'S006765\n\n' + picture() + '\n（网）\n\nMA07\n买票请到12306 发货请到95306';
  const records = parseScanText(text);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'rail');
  assert.equal(records[0].service, 'D3759');
  assert.equal(records[0].origin, '柳州');
  assert.equal(records[0].destination, '来宾北');
  assert.equal(records[0].carriage, '03');
  assert.equal(records[0].seat, '15F');
  assert.equal(records[0].ticketMarks[0].text,'网');
});

test('freestanding seat rows are read without using the printed sales station', () => {
  const cases = [
    ['08车 07B号', '08', '07B'],
    ['03+08A', '03', '08A'],
    ['05車 O55號', '05', '055'],
    ['04车 上085号', '04', '085号上铺'],
    ['08车011号中铺', '08', '011号中铺'],
  ];
  for (const [row, carriage, seat] of cases) {
    const raw = picture().replace('03车15F号', '') + '\n' + row + '\n10010300351001S042775 北京南站售';
    const [ticket] = parseScanText(raw);
    assert.deepEqual([ticket.carriage, ticket.seat, ticket.issuer], [carriage, seat, ''], row);
  }
  const bare = picture().replace('03车15F号', '');
  const [ambiguous] = parseScanText(bare + '\n07417D号\n10010300351001S042775 JM\n退票改签时须交回车站');
  assert.deepEqual([ambiguous.carriage, ambiguous.seat, ambiguous.issuer], ['', '', '']);
  assert.deepEqual(railSeatFromLine('07417D号', { fadedCarriage: true }), { carriage: '07', seat: '17D' });
  assert.equal(railSeatFromLine('074177号', { fadedCarriage: true }), null);
  assert.equal(parseScanText(bare + '\n海口东售')[0].issuer, '');
});

test('retaking a photo replaces an OCR standing seat while preserving a manually chosen carriage', () => {
  const [assigned] = parseScanText(picture());
  const prior = createRecord({ carriage: '03', railStanding: true, fieldSources: { carriage: 'ocr', railStanding: 'ocr' } });
  const updated = railPhotoChanges(prior, assigned);
  assert.equal(updated.seat, '15F');
  assert.equal(updated.railStanding, false);

  const manual = createRecord({ carriage: '08', lockedFields: ['carriage'] });
  const protectedSeat = railPhotoChanges(manual, assigned);
  assert.equal(protectedSeat.carriage, undefined);
  assert.equal(protectedSeat.seat, undefined);
});

test('numeric trains and OCR-confused letters are resolved from their position between stations', () => {
  for (const [printed,expected] of [['6852','6852'],['p3759','D3759'],['Gl','G1']]) {
    const tsv = layout([[printed,430,80,150,45],['Liuzhou',150,140,140,30],['Laibinbei',710,140,170,30]]);
    assert.equal(parseScanText(picture(printed),'photo',{layout:tsv})[0].service,expected);
  }
});

test('distinct serial formats are accepted and a missing train does not discard the visible fields', () => {
  for (const id of ['Z63P073459', 'Z20D076932', 'Z81U009760', 'J085247']) {
    assert.equal(printedRailNumber(id), id);
  }
  assert.equal(printedRailNumber('J08524'), '', 'a clipped five-digit serial is incomplete');
  const [partial] = parseScanText('J085247\n20I8*O8月09 H 09:08开\n￥66.50元\n03车08A号\n限乘当日当次车');
  assert.deepEqual([partial.service, partial.ticketNumber, partial.departureDate.year, partial.departureTime, partial.price, partial.seat],
    ['', 'J085247', 2018, '09:08', '66.50', '08A']);
});

test('coordinate order controls the route when OCR emits the right column first', () => {
  const text = picture().replace('Liuzhou Laibinbei','Laibinbei\n\nLiuzhou');
  const tsv = layout([['D3759',430,80,150,45],['Laibinbei',710,140,170,30],['Liuzhou',150,140,140,30]]);
  const record = parseScanText(text,'test',{layout:tsv})[0];
  assert.equal(record.origin,'柳州'); assert.equal(record.destination,'来宾北');
});

test('a spaced train prefix is retained and a seat number below the station row cannot become a train', () => {
  const text = picture('T 166');
  const tsv = layout([['Lasa',150,140,140,30],['Bengbu',710,140,170,30],['005',550,200,70,35]]);
  assert.equal(parseScanText(text,'test',{layout:tsv})[0].service,'T166');
  assert.equal(parseScanText(picture('???'),'photo',{layout:tsv})[0]?.service || '', '');
});

test('uncertain railway text and footer phone numbers do not become flight or train candidates', () => {
  assert.deepEqual(parseScanText('S006765\n仅供报销使用\n检票口5B'),[]);
  assert.equal(parseScanText(picture('???')+'\nT95306','photo')[0]?.service || '', '');
  assert.deepEqual(parseScanText('BOARDING PASS\n航班：CA181 日期：2025-05-03\n出发：PEK 到达：HND'), []);
});

test('a confident numeric train is not overwritten by an S/5 confusion during regional OCR', async () => {
  const data = {text:picture('5219'),tsv:layout([['5219',430,80,150,45,95],['Liuzhou',150,140,140,30],['Laibinbei',710,140,170,30]])};
  const worker = {recognize:async()=>assert.fail('Confident digits should not be re-guessed'),setParameters:async()=>{}};
  await refineRailService(worker,{},data);
  assert.match(data.text,/^车次：5219/);
});

test('image enhancement can add missing fields but cannot overwrite a conflicting train number', () => {
  const original = {text:picture().replace('2023年05月26日',''),tsv:''};
  assert.equal(preferEnhancedRailRead(original,{text:picture(),tsv:''}),true);
  assert.equal(preferEnhancedRailRead(original,{text:picture('D35759'),tsv:''}),false);
});

test('regional OCR failure restores the worker settings for the next image', async () => {
  const data={text:picture('p3759'),tsv:layout([['p3759',430,80,150,45,35],['Liuzhou',150,140,140,30],['Laibinbei',710,140,170,30]])};
  const settings=[];
  await refineRailService({setParameters:async value=>settings.push(value),recognize:async()=>{throw new Error('unclear crop');}}, {}, data);
  assert.deepEqual(settings.at(-1),{tessedit_char_whitelist:'',tessedit_pageseg_mode:'3'});
  assert.doesNotMatch(data.text,/^车次：/);
});
