import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { demoRecords } from '../src/demo.js';
import { DEMO_RAIL_LINEAR_CODE, DEMO_TICKET_CODE } from '../src/demo-code.js';
import { createRecord } from '../src/model.js';
import { ticketSVG } from '../src/tickets.js';
import { layoutFontFiles } from '../src/ticket-layouts.js';
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, '.preview'), { recursive: true });
execFileSync('python', [resolve(root, 'scripts/prepare-font-previews.py')], { stdio: 'inherit' });
const examples = [
  createRecord({ id:'preview-linear', template:'rail-red-barcode', service:'T41', origin:'北京西', destination:'西安',
    departureDate:'2008-09-12', departureTime:'16:46', carriage:'09', seat:'023号下铺', seatClass:'硬卧',
    price:'270.00', ticketNumber:'X000010', saleCode:'10000000000000X0000100000000000000000000000', issuer:'北京西', ticketCode: DEMO_RAIL_LINEAR_CODE }),
  createRecord({ id:'preview-anonymous', template:'rail-red-qr', service:'T166', origin:'拉萨', destination:'蚌埠',
    departureDate:'2010-01-16', departureTime:'10:00', carriage:'01', seat:'005号中铺', seatClass:'硬卧',
    price:'766.00', ticketNumber:'X000011', saleCode:'10000000000000X000011', issuer:'拉萨', ticketCode: DEMO_TICKET_CODE }),
  createRecord({ id:'preview-supplement', template:'rail-supplement', service:'K608', origin:'天津', destination:'张家口南',
    departureDate:'2015-07-04', carriage:'加1', seat:'19号中铺', seatClass:'硬卧', price:'99.5',
    ticketNumber:'7000001', saleCode:'T1000000000000A000001', issuer:'沈阳客运段',
    railSupplementReason:'客快硬卧', railSupplementFee:'5.0', railSupplementSurcharge:'0.0', ticketCode: DEMO_TICKET_CODE }),
  createRecord({ id:'preview-refund', template:'rail-refund-receipt', service:'G104', origin:'上海虹桥', destination:'济南西',
    departureDate:'2024-06-18', price:'41.5', passenger:'示例旅客', identity:'110101199001010000', ticketNumber:'X000013',
    saleCode:'10000000000000X000013', issuer:'上海虹桥' })
];
const records = [...demoRecords('2024-11-20'), ...examples];
for (const record of records.filter((r, i, rs) => rs.findIndex(x => x.template === r.template) === i)) {
  const svg = ticketSVG(record);
  const fontFiles = layoutFontFiles(record.template).map(([family]) => resolve(root, '.preview/font-previews', family + '.otf'));
  const image = new Resvg(svg, { font: { fontFiles, defaultFontFamily: 'TicketSong', loadSystemFonts: false } });
  await writeFile(resolve(root, `.preview/${record.template}.png`), image.render().asPng());
}
console.log('Rendered current ticket styles at their native aspect ratios.');
