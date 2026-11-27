import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRecord} from '../src/model.js';
import {ticketViewOptions,ticketViewControls,ticketViewEntries,visibleTicketCount,ticketCollection,appendTicketCollection,bindTicketViewControls} from '../src/ticket-view.js';
import {spaceWindow,spherePoint,ticketSpaceMarkup,mountTicketSpace} from '../src/ticket-space.js';
import {timeline} from '../src/timeline.js';

const icon=()=>'<svg class="icon"></svg>';
const rail=(id,values={})=>createRecord({id,origin:'北京南',destination:'南京南',service:'G21',departureDate:'2026-11-16',carriage:'05',seat:'08F',seatClass:'二等座',...values});

test('list view keeps ticket actions and selection without constructing ticket faces',()=>{
  const dom=new JSDOM(ticketCollection([rail('a',{passenger:'<示例>'})],{mode:'list',size:'small'},{icon,selected:new Set(['a'])}));
  assert.equal(dom.window.document.querySelector('[data-archive-select="a"]').checked,true);
  assert.equal(dom.window.document.querySelector('[data-action="view"]').dataset.id,'a');
  assert.equal(dom.window.document.querySelector('.ticket-preview'),null);
  assert.match(dom.window.document.body.textContent,/<示例>/);assert.equal(dom.window.document.querySelector('示例'),null);
  const markup=timeline([rail('a'),rail('fee',{template:'rail-refund-receipt'}),rail('open',{type:'flight',template:'air-boarding-pass',flightStatus:'open'})],icon);
  assert.match(markup,/timeline-list-compact/);assert.match(markup,/data-id="fee"/);assert.match(markup,/data-id="open"/);assert.doesNotMatch(markup,/ticket-preview/);
  dom.window.close();
});

test('appending tickets reuses nodes and merges only the same month across page boundaries', () => {
  const options = { icon, selected: new Set(['a', 'b']) };
  for (const [mode, size] of [['grid','medium'], ['list','medium'], ['grid','small'], ['list','small']]) {
    const view = { mode, size };
    const dom = new JSDOM(ticketCollection([rail('a')], view, options));
    const root = dom.window.document.body, first = root.querySelector('[data-archive-select="a"]');
    try {
      appendTicketCollection(root, [rail('b'), rail('c', { departureDate: '2026-09-01' }),
        rail('d', { departureDate: '2025-11-01' }), rail('e', { departureDate: '2025' }), rail('f', { departureDate: '' })], view, options);
      assert.equal(root.querySelector('[data-archive-select="a"]'), first);
      assert.equal(first.checked, true);
      assert.equal(root.querySelector('[data-archive-select="b"]').checked, true);
      const headings = [...root.querySelectorAll('.ticket-period-heading h2')].map(heading => heading.textContent);
      assert.deepEqual(headings, ['2026 年 11 月', '2026 年 9 月', '2025 年 11 月', '2025 年 · 月份未知', '日期未知']);
      assert.equal(root.querySelector('.ticket-period-heading span').textContent, '2 张票据');
    } finally { dom.window.close(); }
  }
});

test('both grid sizes group dates and the small grid shows only ticket faces',()=>{
  assert.deepEqual(ticketViewOptions({mode:'unknown',size:'invalid'}),{mode:'grid',size:'medium'});
  assert.deepEqual(ticketViewOptions({},'list'),{mode:'list',size:'medium'});
  const value={mode:'grid',size:'medium'},dom=new JSDOM(ticketViewControls(value)+ticketCollection([rail('a')],value,{icon}));
  const root=dom.window.document.body;let changed='';
  function render(){root.innerHTML=ticketViewControls(value)+ticketCollection([rail('a')],value,{icon});bindTicketViewControls(root,{value,change:mode=>{changed=mode;value.mode=mode;render();}});}
  render();
  assert.equal(root.querySelector('.ticket-grid').style.getPropertyValue('--ticket-min'),'390px');
  assert.equal(root.querySelector('.ticket-card [data-action="view"]'), root.querySelector('.ticket-preview'));
  assert.equal(root.querySelectorAll('.ticket-card [data-action="view"]').length, 1);
  assert.equal(root.querySelector('[type="range"]'),null);
  assert.deepEqual([...root.querySelectorAll('[data-ticket-size]')].map(button=>button.textContent),['小','中']);
  root.querySelector('[data-ticket-size="small"]').click();
  assert.equal(root.querySelector('.ticket-grid').style.getPropertyValue('--ticket-min'),'156px');
  assert.equal(root.querySelector('.ticket-grid').dataset.facesOnly,'true');
  assert.equal(root.querySelector('.ticket-period-heading h2').textContent,'2026 年 11 月');
  assert.ok(root.querySelector('.ticket-face>.card-select'),'selection belongs to the face overlay');
  root.querySelector('[data-ticket-size="medium"]').click();assert.equal(root.querySelector('.ticket-grid').style.getPropertyValue('--ticket-min'),'390px');
  assert.equal(root.querySelector('.ticket-grid').dataset.facesOnly,'false');assert.equal(root.querySelectorAll('[data-ticket-size][aria-pressed="true"]').length,1);assert.ok(root.querySelector('.ticket-period-heading'));
  root.querySelector('[data-ticket-view="space"]').click();assert.equal(changed,'space');
  const rows=Array.from({length:55},(_,i)=>rail('row-'+i,{departureDate:i<20 ? '2026-11-16' : '2025-10-01'}));
  root.innerHTML=ticketCollection(rows.slice(0,48),{mode:'list',size:'medium'},{icon,selected:new Set(['row-2'])});
  assert.equal(root.querySelectorAll('.timeline-item').length,48);assert.equal(root.querySelectorAll('.ticket-period-heading').length,2);
  assert.equal(root.querySelector('[data-archive-select="row-2"]').checked,true);assert.equal(root.querySelector('.ticket-preview'),null);
  root.innerHTML=ticketCollection([rows[0],rows[20],rows[1]],{mode:'list',size:'medium'},{icon,sort:'price-asc'});
  assert.equal(root.querySelector('.ticket-period-heading'),null);assert.deepEqual([...root.querySelectorAll('.timeline-item')].map(button=>button.dataset.id),['row-0','row-20','row-1']);
  dom.window.close();
});

test('grid stacks stay together under the first visible flight and count every leg across pages', () => {
  const flight = (id, values = {}) => createRecord({ id, type: 'flight', template: 'air-boarding-pass',
    origin: 'PEK', destination: 'NRT', service: 'CA181', departureDate: '2026-11-30', ticketNumber: '999-0000001001/1', ...values });
  const first = flight('first');
  const next = flight('next', { origin: 'NRT', destination: 'LAX', service: 'NH006', departureDate: '2026-12-01', ticketNumber: '9990000001001/2' });
  const railTicket = rail('train', { departureDate: '2026-12-02' });
  const records = [railTicket, next, first];
  for (const size of ['medium', 'small']) {
    const view = { mode: 'grid', size }, options = { icon, selected: new Set(['next']) };
    const entries = ticketViewEntries(records, view);
    assert.deepEqual(entries.map(record => record.id), ['train', 'first']);
    assert.equal(visibleTicketCount(entries), 3);
    const dom = new JSDOM(ticketCollection(entries.slice(0, 1), view, options));
    try {
      const root = dom.window.document.body;
      appendTicketCollection(root, entries.slice(1), view, options);
      const stack = root.querySelector('.ticket-period[data-ticket-period="2026-11"] .ticket-stack');
      assert.deepEqual([...stack.querySelectorAll('[data-action="view"]')].map(button => button.dataset.id), ['first', 'next']);
      assert.equal(stack.querySelectorAll('.ticket-preview > svg').length, 2);
      assert.equal(stack.querySelector('[data-archive-select="next"]').checked, true);
      assert.equal(stack.querySelector('[data-archive-select="first"]').checked, false);
      appendTicketCollection(root, [rail('more')], view, options);
      assert.equal(stack.closest('.ticket-period').querySelector('.ticket-period-heading span').textContent, '3 张票据');
    } finally { dom.window.close(); }
  }
  assert.equal(ticketViewEntries([next], { mode: 'grid' })[0].stackedFlights, undefined);
  assert.deepEqual(ticketViewEntries(records, { mode: 'list' }), records);
});

test('3D navigation bounds rendered tickets, excludes selection, and supports zoom, drag and cleanup',()=>{
  const records=Array.from({length:240},(_,i)=>rail('ticket-'+i,{service:'G'+(i+1)}));
  for(const count of [1,2,7,36,240]){
    const shown=spaceWindow(records.slice(0,count),count-1);assert.ok(shown.length<=36);assert.ok(shown.some(item=>item.index===count-1));
    assert.equal(new Set(shown.map(item=>item.record.id)).size,shown.length);
    for(let i=0;i<shown.length;i++){const point=spherePoint(i,shown.length);assert.ok(Math.abs(Math.hypot(point.x,point.y,point.z)-235)<.000001);}
  }
  assert.deepEqual(spaceWindow([],0),[]);
  const reached=new Set();for(let index=0;index<records.length;index++)for(const item of spaceWindow(records,index))reached.add(item.record.id);
  assert.equal(reached.size,records.length);
  const dom=new JSDOM(ticketSpaceMarkup()),root=dom.window.document.querySelector('[data-ticket-space]'),frame=root.querySelector('.space-viewport');
  const dispose=mountTicketSpace(root,records);
  const key=name=>frame.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));
  assert.equal(root.querySelector('[data-space-command], [data-space-count], .space-navigation, .space-tools'),null);
  assert.equal(root.querySelectorAll('.space-ticket').length,36);assert.equal(root.querySelector('[data-archive-select]'),null);
  assert.equal(root.querySelectorAll('.space-sphere-ring').length,11);
  key('ArrowRight');assert.equal(root.querySelector('.space-ticket-current [data-action="view"]').dataset.id,'ticket-1');
  frame.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(root.querySelector('.space-ticket-current [data-action="view"]').dataset.id,'ticket-2');
  const wheel=new dom.window.WheelEvent('wheel',{deltaY:-60,ctrlKey:true,cancelable:true});frame.dispatchEvent(wheel);assert.equal(wheel.defaultPrevented,true);assert.ok(Number(root.dataset.zoom)>100);
  const beforeScroll=root.querySelector('.space-world').style.transform,zoomBefore=root.dataset.zoom;
  const scroll=new dom.window.WheelEvent('wheel',{deltaX:30,deltaY:45,cancelable:true});frame.dispatchEvent(scroll);
  assert.equal(scroll.defaultPrevented,true);assert.notEqual(root.querySelector('.space-world').style.transform,beforeScroll);assert.equal(root.dataset.zoom,zoomBefore);
  const lineScroll=new dom.window.WheelEvent('wheel',{deltaY:1,deltaMode:1,cancelable:true});frame.dispatchEvent(lineScroll);assert.equal(lineScroll.defaultPrevented,true);
  for(const type of ['selectstart','dragstart']){const event=new dom.window.Event(type,{bubbles:true,cancelable:true});root.querySelector('.space-ticket-face').dispatchEvent(event);assert.equal(event.defaultPrevented,true);}
  const pointer=(type,x,y)=>{const event=new dom.window.MouseEvent(type,{clientX:x,clientY:y,bubbles:true});Object.defineProperty(event,'pointerId',{value:1});frame.dispatchEvent(event);};
  const before=root.querySelector('.space-world').style.transform;pointer('pointerdown',100,100);pointer('pointermove',250,130);pointer('pointerup',250,130);
  assert.notEqual(root.querySelector('.space-world').style.transform,before);
  let opened=0;dom.window.document.addEventListener('click',event=>{if(event.target.closest('[data-action="view"]'))opened++;});
  root.querySelector('.space-ticket-current [data-action="view"]').click();assert.equal(opened,0,'drag must not open a ticket');
  pointer('pointerdown',100,100);pointer('pointerup',100,100);root.querySelector('.space-ticket-current [data-action="view"]').click();assert.equal(opened,1);
  key('0');assert.equal(root.dataset.zoom,'100');
  for(let i=0;i<35;i++)key('ArrowRight');
  assert.equal(root.querySelector('.space-ticket-current [data-action="view"]').dataset.id,'ticket-37');
  assert.equal(root.querySelector('.space-ticket-face').dataset.id,'ticket-36');assert.equal(root.querySelectorAll('.space-ticket').length,36);
  for(let i=0;i<2;i++)key('ArrowLeft');
  assert.equal(root.querySelector('.space-ticket-face').dataset.id,'ticket-0');
  dispose();key('ArrowRight');assert.equal(root.querySelector('.space-ticket-current [data-action="view"]').dataset.id,'ticket-35');
  dom.window.close();
});

test('pointer moves share one animation frame and queued work stops when leaving the sphere',()=>{
  const dom=new JSDOM(ticketSpaceMarkup()),{window}=dom,root=window.document.querySelector('[data-ticket-space]');
  const pending=new Map();let next=0;
  window.requestAnimationFrame=callback=>{pending.set(++next,callback);return next;};
  window.cancelAnimationFrame=id=>pending.delete(id);
  const flush=()=>{const callbacks=[...pending.values()];pending.clear();callbacks.forEach(callback=>callback(16));};
  const dispose=mountTicketSpace(root,[rail('a')]),frame=root.querySelector('.space-viewport'),world=root.querySelector('.space-world');flush();
  const before=world.style.transform;
  const pointer=(type,x,y=100)=>{const event=new window.MouseEvent(type,{clientX:x,clientY:y,bubbles:true,cancelable:true});Object.defineProperty(event,'pointerId',{value:1});frame.dispatchEvent(event);return event;};
  assert.equal(pointer('pointerdown',100).defaultPrevented,true);
  for(let x=110;x<=200;x+=10)pointer('pointermove',x);
  assert.equal(pending.size,1);assert.equal(world.style.transform,before);flush();assert.notEqual(world.style.transform,before);
  pointer('pointermove',250,1300);flush();assert.match(world.style.transform,/rotateX\(-360deg\)/,'rotation continues through both poles');
  pointer('pointermove',300,1400);assert.equal(pending.size,1);dispose();assert.equal(pending.size,0);
  dom.window.close();
});
