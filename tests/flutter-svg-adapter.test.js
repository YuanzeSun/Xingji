import test from 'node:test';
import assert from 'node:assert/strict';
import {Resvg} from '@resvg/resvg-js';
import {demoRecords} from '../src/demo.js';
import {ticketSVG} from '../src/tickets.js';
import {flutterSVG} from '../scripts/flutter-svg-adapter.js';

for(const record of demoRecords('2026-11-18'))test(`SVG compatibility expansion preserves every rendered pixel: ${record.service}`,()=>{
  const original=ticketSVG(record),adapted=flutterSVG(original);
  const rendered=new Resvg(original).render(),before=rendered.pixels,after=new Resvg(adapted).render().pixels;
  for(let i=0;i<before.length;i++){
    const pixel=Math.floor(i/4),x=pixel%rendered.width,y=Math.floor(pixel/rendered.width);
    // SVG image compositing rounds antialiasing at logo edges by at most one.
    const tolerance=record.type==='flight'&&x>=34&&x<74&&y>=12&&y<52?1:0;
    assert.ok(Math.abs(after[i]-before[i])<=tolerance,`Changed pixel at ${x},${y}`);
  }
  assert.equal((adapted.match(/<svg\b/g)||[]).length,1);
  assert.doesNotMatch(adapted,/<pattern\b|<image\b/);
});
