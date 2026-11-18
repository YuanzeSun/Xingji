import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile,copyFile,readdir,readFile} from 'node:fs/promises';
import {ticketSVG} from '../src/tickets.js';
import {demoRecords} from '../src/demo.js';
import {flutterSVG} from './flutter-svg-adapter.js';
import {registerTicketFont,outlineTicketText,setTicketStock} from './flutter-text-outlines.js';
import {layoutFontFiles} from '../src/ticket-layouts.js';
import {DOMParser} from '@xmldom/xmldom';
import {Resvg} from '@resvg/resvg-js';
import {createRecord} from '../src/model.js';
import {writeRendererNotices} from './prepare-flutter-notices.mjs';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const bundleRenderer=()=>build({entryPoints:['scripts/flutter-ticket-entry.js'],bundle:true,format:'iife',globalName:'XingjiTickets',platform:'browser',target:'es2022',minify:true,write:false,metafile:true});
const rendererPaths=['apps/flutter/assets/renderer.js','apps/flutter/web/renderer.js'];
if(process.argv.includes('--check')){
  const expected=(await bundleRenderer()).outputFiles[0].text;
  for(const path of rendererPaths)if((await readFile(path,'utf8')).replaceAll('\r\n','\n')!==expected){
    throw new Error(path+' is stale; run node scripts/prepare-flutter-renderer.mjs');
  }
  console.log('Flutter renderer and shared archive validator are up to date.');
  process.exit(0);
}


await mkdir('apps/flutter/assets/tickets',{recursive:true});
for(const [family,file]of new Map(demoRecords('2026-11-18').flatMap(record=>layoutFontFiles(record.template)).map(([family,file])=>[family,[family,file]])).values()){
  await registerTicketFont(family,await readFile('apps/flutter/assets/fonts/'+file.replace('.woff2','.ttf')),file);
}
const stocks={};
for(const template of ['rail-blue','rail-red']){
  const record=createRecord({id:'flutter-stock',type:'rail',template});
  const document=new DOMParser().parseFromString(ticketSVG(record),'image/svg+xml');
  const printed=[...document.getElementsByTagName('g')].find(node=>node.getAttribute('paint-order')==='stroke'&&node.hasAttribute('transform'));
  printed.parentNode.removeChild(printed);
  const source=outlineTicketText(document.toString());
  const png=new Resvg(source,{fitTo:{mode:'width',value:template==='rail-blue'?1712:1800}}).render().asPng();
  await writeFile(`apps/flutter/assets/${template}-stock.png`,png);
  const uri='data:image/png;base64,'+png.toString('base64');
  for(const kind of template==='rail-blue'?['rail-blue','rail-receipt','rail-refund-receipt']:['rail-red','rail-red-classic']){stocks[kind]=uri;setTicketStock(kind,uri);}
}
const stockImages=[...new Set(Object.values(stocks))];
const stockAliases=Object.entries(stocks).map(([template,image])=>`${JSON.stringify(template)}:images[${stockImages.indexOf(image)}]`);
await writeFile('apps/flutter/assets/ticket-stock-data.js','// Generated from the original stock artwork at the original 2x export size.\nconst images='+JSON.stringify(stockImages)+';\nexport default {'+stockAliases.join(',')+'};\n');
const result=await bundleRenderer();
await writeRendererNotices(result.metafile.inputs);
const source=result.outputFiles[0].text;
for(const path of rendererPaths)await writeFile(path,source);
for(const record of demoRecords('2026-11-18')){
  await writeFile(`apps/flutter/assets/tickets/${record.id}.svg`,ticketSVG(record));
  await writeFile(`apps/flutter/assets/tickets/${record.id}.display.svg`,flutterSVG(outlineTicketText(ticketSVG(record),record.template)));
}
for(const file of await readdir('public/fonts')) {
  if(file.endsWith('.txt')) await copyFile(`public/fonts/${file}`,`apps/flutter/assets/fonts/${file}`);
}
console.log(`Bundled original ticket renderer (${source.length} characters), original SVG examples and font notices.`);
