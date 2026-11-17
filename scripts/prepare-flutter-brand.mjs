import {Resvg} from '@resvg/resvg-js';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const svg=await readFile('public/icons/icon.svg','utf8');
const png=size=>new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng();
for(const root of ['apps/flutter/ios/Runner/Assets.xcassets/AppIcon.appiconset','apps/flutter/macos/Runner/Assets.xcassets/AppIcon.appiconset']){
  const manifest=JSON.parse(await readFile(`${root}/Contents.json`,'utf8'));
  for(const image of manifest.images){if(!image.filename)continue;await writeFile(`${root}/${image.filename}`,png(Math.round(parseFloat(image.size)*parseFloat(image.scale||'1'))));}
}
for(const [density,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]]){
  const root=`apps/flutter/android/app/src/main/res/mipmap-${density}`;await mkdir(root,{recursive:true});await writeFile(`${root}/ic_launcher.png`,png(size));
}
for(const file of await readdir('apps/flutter/web/icons')){if(file.endsWith('.png'))await writeFile(`apps/flutter/web/icons/${file}`,png(file.includes('192')?192:512));}
await writeFile('apps/flutter/web/favicon.png',png(48));
const icon=png(256),header=Buffer.alloc(22);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(icon.length,14);header.writeUInt32LE(22,18);
await writeFile('apps/flutter/windows/runner/resources/app_icon.ico',Buffer.concat([header,icon]));
console.log('Prepared platform icons from the existing Xingji brand.');
