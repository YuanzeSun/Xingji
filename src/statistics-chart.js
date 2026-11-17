import {escape as e} from './html.js';

const LEFT=42,HEIGHT=290,BOTTOM=244,MAX_ZOOM=8;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const baseWidth=series=>Math.max(720,series.length*96);
const percentage=zoom=>(zoom*100).toLocaleString('zh-CN',{maximumFractionDigits:zoom<.01 ? 2 : zoom<1 ? 1 : 0})+'%';
function content(series,width,enter=false) {
  const right=width-LEFT,peak=Math.max(1,...series.flatMap(row=>[row.rail,row.flight]));
  const step=Math.max(1,Math.ceil(peak/4)),max=step*4,spacing=(right-LEFT)/Math.max(1,series.length-1),labels=Math.max(1,Math.ceil(76/spacing));
  const x=i=>series.length===1 ? width/2 : LEFT+i*spacing,y=count=>BOTTOM-count/max*(BOTTOM-22);
  const grid=Array.from({length:5},(_,i)=>`<path class="statistics-gridline" d="M${LEFT},${y(i*step)}H${right}"/><text class="statistics-axis" x="${LEFT-10}" y="${y(i*step)+4}" text-anchor="end">${i*step}</text>`).join('');
  const lines=['rail','flight'].map(type=>`<polyline class="statistics-line ${type}" points="${series.map((row,i)=>`${x(i)},${y(row[type])}`).join(' ')}"/>`).join('');
  const dots=series.map((row,i)=>`<g>${['rail','flight'].map(type=>`<circle class="statistics-dot ${type}" cx="${x(i)}" cy="${y(row[type])}" r="${Math.max(2,Math.min(5,spacing/5))}" tabindex="0" role="button" data-stat-period="${e(row.key)}" aria-label="${e(row.label)}，火车 ${row.rail} 次，飞机 ${row.flight} 次"><title>${e(row.label)} · 火车 ${row.rail} 次 · 飞机 ${row.flight} 次</title></circle>`).join('')}${i%labels===0 || i===series.length-1 ? `<text class="statistics-axis" x="${x(i)}" y="272" text-anchor="middle">${e(row.label)}</text>` : ''}</g>`).join('');
  return grid+`<g class="statistics-series${enter ? ' is-entering' : ''}">${lines}${dots}</g>`;
}
export function tripChartMarkup(series,{zoom=1,viewportWidth=720}={}) {
  const width=Math.max(viewportWidth,Math.round(baseWidth(series)*zoom));
  const controls=`<div class="statistics-chart-toolbar"><div class="statistics-legend"><span class="rail">火车</span><span class="flight">飞机</span></div><div class="statistics-chart-zoom" role="group" aria-label="折线图缩放"><button type="button" data-stat-zoom="out" aria-label="缩小折线图" ${series.length ? '' : 'disabled'}>−</button><span data-stat-zoom-label aria-label="图表缩放比例">${percentage(zoom)}</span><button type="button" data-stat-zoom="in" aria-label="放大折线图" ${series.length ? '' : 'disabled'}>＋</button><button type="button" data-stat-zoom="fit" ${series.length ? '' : 'disabled'}>全览</button></div></div>`;
  if(!series.length)return controls+'<div class="statistics-empty">所选日期范围内暂无可统计的行程</div>';
  return controls+`<div class="statistics-chart-scroll" tabindex="0" role="region" aria-label="乘坐次数图表，可横向滚动、双指缩放，或用加减键缩放"><svg class="statistics-chart" viewBox="0 0 ${width} ${HEIGHT}" style="width:${width}px;min-width:${width}px" role="group" aria-label="火车与飞机乘坐次数折线图">${content(series,width,true)}</svg></div><output class="statistics-chart-readout" aria-live="polite"></output>`;
}

export function bindTripChart(container,series,options,{onZoom=()=>{}}={}) {
  const frame=container.querySelector('.statistics-chart-scroll');if(!frame)return ()=>{};
  const svg=frame.querySelector('svg'),win=container.ownerDocument.defaultView;
  const request=win.requestAnimationFrame?.bind(win) || (fn=>setTimeout(()=>fn(Date.now()),16)),cancel=win.cancelAnimationFrame?.bind(win) || clearTimeout;
  const motion=win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let animation=0,disposed=false,gesture=null,targetZoom=options.chartZoom,lastViewport=0;
  const viewport=()=>frame.clientWidth || container.clientWidth || 720;
  const minimum=()=>Math.min(MAX_ZOOM,viewport()/baseWidth(series));
  const normalized=pixel=>{
    const width=Number(svg.getAttribute('viewBox').split(' ')[2]),physical=svg.getBoundingClientRect().width || width;
    return clamp(((frame.scrollLeft+pixel)*width/physical-LEFT)/(width-LEFT*2),0,1);
  };
  function draw(zoom,time,anchor,enter=false,notify=true) {
    if(disposed)return;
    options.chartZoom=clamp(zoom,minimum(),MAX_ZOOM);
    const width=Math.max(viewport(),Math.round(baseWidth(series)*options.chartZoom));
    svg.setAttribute('viewBox',`0 0 ${width} ${HEIGHT}`);svg.style.width=width+'px';svg.style.minWidth=width+'px';svg.innerHTML=content(series,width,enter);
    if(time!==undefined)frame.scrollLeft=clamp(LEFT+time*(width-LEFT*2)-anchor,0,Math.max(0,width-viewport()));
    container.querySelector('[data-stat-zoom-label]').textContent=percentage(options.chartZoom);
    container.querySelector('[data-stat-zoom="out"]').disabled=options.chartZoom<=minimum()+.000001;
    container.querySelector('[data-stat-zoom="in"]').disabled=options.chartZoom>=MAX_ZOOM-.000001;
    if(notify)onZoom();
  }
  function stop() {if(animation)cancel(animation);animation=0;}
  function zoomTo(value,{anchor=viewport()/2,time=normalized(anchor),smooth=false}={}) {
    stop();const start=options.chartZoom;targetZoom=clamp(value,minimum(),MAX_ZOOM);
    if(!smooth || motion?.matches || series.length>480 || start===targetZoom){draw(targetZoom,time,anchor);return;}
    let began;
    const tick=now=>{if(disposed)return;began ??= now;const progress=Math.min(1,(now-began)/220),eased=1-(1-progress)**3;draw(start+(targetZoom-start)*eased,time,anchor);animation=progress<1 ? request(tick) : 0;};
    animation=request(tick);
  }
  const click=event=>{
    const button=event.target.closest('[data-stat-zoom]');if(!button)return;
    zoomTo(button.dataset.statZoom==='fit' ? minimum() : (animation ? targetZoom : options.chartZoom)*(button.dataset.statZoom==='in' ? 1.25 : .8),{smooth:true});
  };
  const wheel=event=>{if(!event.ctrlKey && !event.metaKey)return;event.preventDefault();zoomTo(options.chartZoom*Math.exp(-clamp(event.deltaY,-150,150)*.004),{anchor:clamp(event.clientX-frame.getBoundingClientRect().left,0,viewport())});};
  const touchStart=event=>{
    if(event.touches.length!==2)return;stop();
    const [a,b]=event.touches,anchor=(a.clientX+b.clientX)/2-frame.getBoundingClientRect().left;
    gesture={span:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),zoom:options.chartZoom,time:normalized(anchor)};
    if(event.cancelable)event.preventDefault();
  };
  const touchMove=event=>{
    if(!gesture || event.touches.length!==2)return;
    if(event.cancelable)event.preventDefault();
    const [a,b]=event.touches,span=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    if(gesture.span)zoomTo(gesture.zoom*span/gesture.span,{anchor:(a.clientX+b.clientX)/2-frame.getBoundingClientRect().left,time:gesture.time});
  };
  const touchEnd=event=>{if(event.touches.length!==2)gesture=null;};
  const keydown=event=>{if(!['+','=','-','0'].includes(event.key))return;event.preventDefault();if(event.target!==frame)frame.focus({preventScroll:true});zoomTo(event.key==='0' ? minimum() : options.chartZoom*(event.key==='-' ? .8 : 1.25),{smooth:true});};
  container.addEventListener('click',click);frame.addEventListener('wheel',wheel,{passive:false});frame.addEventListener('touchstart',touchStart,{passive:false});frame.addEventListener('touchmove',touchMove,{passive:false});frame.addEventListener('touchend',touchEnd);frame.addEventListener('touchcancel',touchEnd);frame.addEventListener('keydown',keydown);
  const observer=win.ResizeObserver ? new win.ResizeObserver(()=>{const width=viewport();if(width===lastViewport)return;lastViewport=width;stop();draw(options.chartZoom,undefined,0,false,false);}) : null;
  observer?.observe(frame);lastViewport=viewport();draw(options.chartZoom,undefined,0,true,false);
  return ()=>{disposed=true;stop();observer?.disconnect();container.removeEventListener('click',click);frame.removeEventListener('wheel',wheel);frame.removeEventListener('touchstart',touchStart);frame.removeEventListener('touchmove',touchMove);frame.removeEventListener('touchend',touchEnd);frame.removeEventListener('touchcancel',touchEnd);frame.removeEventListener('keydown',keydown);};
}
