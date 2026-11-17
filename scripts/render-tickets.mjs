import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { demoRecords } from '../src/demo.js';
import { ticketSVG } from '../src/tickets.js';
import { layoutFontFiles } from '../src/ticket-layouts.js';
const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, '.preview'), { recursive: true });
execFileSync('python', [resolve(root, 'scripts/prepare-font-previews.py')], { stdio: 'inherit' });
for (const record of demoRecords().filter((r, i, rs) => rs.findIndex(x => x.template === r.template) === i)) {
  const svg = ticketSVG(record);
  const fontFiles = layoutFontFiles(record.template).map(([family]) => resolve(root, '.preview/font-previews', family + '.otf'));
  const image = new Resvg(svg, { font: { fontFiles, defaultFontFamily: 'TicketSong', loadSystemFonts: false } });
  await writeFile(resolve(root, `.preview/${record.template}.png`), image.render().asPng());
}
console.log('Rendered current ticket styles at their native aspect ratios.');
