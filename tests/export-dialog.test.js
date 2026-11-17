import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { demoRecords } from '../src/demo.js';
import { exportDialog,bindExportDialog } from '../src/export-dialog.js';

test('selected tickets export in the requested format without a second selection and closing cancels pending work', async () => {
  for(const format of ['pdf','zip']){
    const records=demoRecords().slice(0,2),dom=new JSDOM(exportDialog(records,{format})),root=dom.window.document.body,downloads=[];
    let resolveWork,options,seen;
    const generate=(snapshot,input)=>{seen=snapshot;options=input;return new Promise(resolve=>{resolveWork=resolve;});};
    const cleanup=bindExportDialog(root,records,{download:(blob,name)=>downloads.push(name),images:format==='zip'?generate:()=>assert.fail('Wrong format'),album:format==='pdf'?generate:()=>assert.fail('Wrong format')});
    assert.equal(root.querySelector('[data-export-index]'),null);root.querySelector('[data-export-format]').click();
    assert.deepEqual(seen,records);assert.equal(root.querySelector('[data-export-format]').disabled,true);
    options.onProgress({completed:1,total:2,phase:'生成中'});assert.match(root.querySelector('.batch-progress p').textContent,/1 \/ 2/);
    resolveWork(new Blob(['test']));await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(downloads.length,1);assert.ok(downloads[0].endsWith('.'+format));
    root.querySelector('[data-export-format]').click();cleanup();assert.equal(options.signal.aborted,true);
    resolveWork(new Blob(['late']));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(downloads.length,1);
    dom.window.close();
  }
});
