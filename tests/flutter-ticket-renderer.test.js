import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {ticketSVG} from '../src/tickets.js';
import {demoRecords} from '../src/demo.js';

const source=await readFile(new URL('../apps/flutter/assets/renderer.js',import.meta.url),'utf8');
// No browser helpers: the native engine receives this same bundle.
const context=vm.createContext({});
vm.runInContext(source,context,{timeout:5000});
for(const record of demoRecords('2026-11-18'))test(`Flutter preserves the complete original ticket SVG: ${record.service} ${record.template}`,()=>{
  context.record=JSON.stringify(record);
  const actual=vm.runInContext('XingjiTickets.render(record)',context,{timeout:5000});
  assert.equal(actual,ticketSVG(record));
});
