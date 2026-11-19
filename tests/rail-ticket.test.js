import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanText, scanCandidate } from '../src/scan-engine.js';
import { refineRailService, refineRailTemplate, preferEnhancedRailRead } from '../src/rail-ocr.js';
import { railPaperFromPixels } from '../src/rail-template.js';

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

test('rail OCR can re-read a missing train directly between the station headings', async () => {
  const data = { text: picture('???'), tsv: layout([['Liuzhou',150,140,140,30],['Laibinbei',710,140,170,30]]) };
  await refineRailService({
    setParameters: async () => {},
    recognize: async (_image, { rectangle }) => {
      assert.ok(rectangle.left > 230 && rectangle.left + rectangle.width < 745);
      return { data: { text: 'D3759', confidence: 90 } };
    }
  }, {}, data);
  assert.equal(scanCandidate(data.text, 90, 'rail', { layout: data.tsv }).service, 'D3759');
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

test('numeric trains and OCR-confused letters are resolved from their position between stations', () => {
  for (const [printed,expected] of [['6852','6852'],['p3759','D3759'],['Gl','G1']]) {
    const tsv = layout([[printed,430,80,150,45],['Liuzhou',150,140,140,30],['Laibinbei',710,140,170,30]]);
    assert.equal(scanCandidate(picture(printed),85,'rail',{layout:tsv}).service,expected);
  }
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
  assert.equal(scanCandidate(picture('???'),90,'rail',{layout:tsv}),null);
});

test('uncertain railway text and footer phone numbers do not become flight or train candidates', () => {
  assert.deepEqual(parseScanText('S006765\n仅供报销使用\n检票口5B'),[]);
  assert.equal(scanCandidate(picture('???')+'\nT95306',90,'rail'),null);
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
