import {railWgs84Point,railMapPoint} from './rail-projection.js';

export const RAIL_LINE_SOURCE='https://fog.vicc.wang/rails';
const origin='https://fog.vicc.wang',caches=new WeakMap();
const station=value=>String(value||'').replace(/\s|站$/g,'');
const lineName=value=>String(value||'').replace(/[（(].*[）)]$/,'').trim();
const validPoint=point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&Math.abs(point[0])<=180&&Math.abs(point[1])<90;
const km=(a,b)=>Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*Math.PI/360),a[1]-b[1])*111.32;

export function candidateRailLines(route,catalog,limit=12) {
  const names=new Set((route.fullRoute||route).stops.map(stop=>station(stop.name))),seen=new Set();
  return Object.values(catalog).filter(line=>line&&typeof line.name==='string'&&line.name.length<=100&&Array.isArray(line.stations)&&line.stations.length<=1000)
    .map(line=>({...line,matches:line.stations.filter(name=>names.has(station(name))).length}))
    .filter(line=>line.matches).sort((a,b)=>b.matches-a.matches||a.stations.length-b.stations.length)
    .filter(line=>{const key=lineName(line.name);if(!key||seen.has(key))return false;seen.add(key);return true;}).slice(0,limit);
}

const cellSize=.025;
const cell=([x,y])=>[Math.floor(x/cellSize),Math.floor(y/cellSize)];
function lineIndex(lines) {
  const cells=new Map();
  for(const {name,segments} of lines)for(const points of segments)for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];if(!validPoint(a)||!validPoint(b))continue;
    const lo=cell([Math.min(a[0],b[0]),Math.min(a[1],b[1])]),hi=cell([Math.max(a[0],b[0]),Math.max(a[1],b[1])]);
    if((hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)>400)continue;
    for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++){
      const key=x+','+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push({name,a,b});
    }
  }
  return cells;
}
function distanceToSegment(point,a,b) {
  const cos=Math.cos(point[1]*Math.PI/180),dx=(b[0]-a[0])*cos,dy=b[1]-a[1],length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((point[0]-a[0])*cos*dx+(point[1]-a[1])*dy)/length)):0;
  return Math.hypot((point[0]-a[0])*cos-t*dx,point[1]-a[1]-t*dy)*111.32;
}
function nearestLine(coordinates,index) {
  const point=railWgs84Point(coordinates),[x,y]=cell(point),distances=new Map();
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const segment of index.get((x+dx)+','+(y+dy))||[]){
    const distance=distanceToSegment(point,segment.a,segment.b);
    if(distance<.12&&distance<(distances.get(segment.name)??Infinity))distances.set(segment.name,distance);
  }
  const sorted=[...distances].sort((a,b)=>a[1]-b[1]);
  return sorted.length&&(!sorted[1]||sorted[1][1]-sorted[0][1]>.01)?sorted[0][0]:'';
}
function samples(segments) {
  const result=[];let base=0;
  for(const points of segments){
    let walked=0,next=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=km(a,b);
      if(!length)continue;
      while(next<=walked+length&&result.length<8000){
        const t=(next-walked)/length;
        result.push({coordinates:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],distance:base+next});next+=2;
      }
      walked+=length;
    }
    base+=walked;
  }
  return result;
}

// Station membership only narrows downloads. A name is assigned after a sustained
// geometric match in WGS84, not inferred from a train prefix or its endpoints.
export function matchRailLineNames(geometry,lines) {
  const index=lineIndex(lines),runs=[];
  for(const point of samples(geometry.segments)){
    const name=nearestLine(point.coordinates,index),previous=runs.at(-1);
    if(name&&previous?.name===name)previous.points.push(point);
    else runs.push({name,points:[point]});
  }
  const matched=new Map();
  for(const run of runs)if(run.name)matched.set(run.name,(matched.get(run.name)||0)+run.points.at(-1).distance-run.points[0].distance);
  const accepted=new Set(lines.filter(line=>{
    const common=geometry.stops.filter(stop=>line.stations?.some(name=>station(name)===station(stop.name)));
    const minimum=common.length>=2?Math.max(12,km(common[0].coordinates,common.at(-1).coordinates)*.2):40;
    return (matched.get(line.name)||0)>=minimum;
  }).map(line=>line.name));
  const labels=[];
  for(const run of runs){
    const length=run.points.at(-1).distance-run.points[0].distance;
    if(!accepted.has(run.name)||length<12)continue;
    const count=Math.max(1,Math.ceil(length/30));
    for(let i=0;i<count&&labels.length<400;i++)labels.push({name:run.name,coordinates:run.points[Math.min(run.points.length-1,Math.floor((i+.5)*run.points.length/count))].coordinates});
  }
  return labels;
}

async function sourceJSON(path,fetcher,cache,maxBytes,signal) {
  if(!cache.has(path)){
    const promise=(async()=>{
      const response=await fetcher.call(globalThis,new URL(path,origin).href,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000),credentials:'omit',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error('暂未取得铁路线路名称');
      const text=await response.text();if(text.length>maxBytes)throw new Error('线路名称数据过大');return JSON.parse(text);
    })();cache.set(path,promise);promise.catch(()=>cache.delete(path));
    if(cache.size>64)cache.delete(cache.keys().next().value);
  }
  return cache.get(path);
}
export async function loadRailLineNames(route,{fetcher=globalThis.fetch,signal}={}) {
  if(!caches.has(fetcher))caches.set(fetcher,new Map());const cache=caches.get(fetcher);
  let catalog;
  try{catalog=await sourceJSON('/json/railsConfig/rails.json',fetcher,cache,300000,signal);}catch{return route;}
  if(signal?.aborted)return route;
  const candidates=candidateRailLines(route,catalog),lines=[];let next=0;
  // Keep a slow optional source from consuming the entire RailGo query budget.
  const deadline=AbortSignal.timeout(15000), downloadSignal=signal ? AbortSignal.any([signal,deadline]) : deadline;
  await Promise.all(Array.from({length:Math.min(3,candidates.length)},async()=>{
    while(next<candidates.length&&!downloadSignal.aborted){
      const candidate=candidates[next++];
      try{
        const data=await sourceJSON('/json/rails/'+encodeURIComponent(candidate.name)+'.geojson',fetcher,cache,2000000,downloadSignal);
        if(!Array.isArray(data.features)||data.features.length>1000)continue;
        const segments=data.features.flatMap(feature=>feature?.geometry?.type==='LineString'?[feature.geometry.coordinates]:feature?.geometry?.type==='MultiLineString'?feature.geometry.coordinates:[]);
        if(segments.some(line=>!Array.isArray(line)||line.length<2||!line.every(validPoint))||segments.reduce((sum,line)=>sum+line.length,0)>100000)continue;
        lines.push({name:lineName(candidate.name),stations:candidate.stations,segments});
      }catch{ /* A missing name must not discard a matched RailGo route. */ }
    }
  }));
  if(!lines.length||signal?.aborted)return route;
  return {...route,lineLabels:matchRailLineNames(route,lines),...(route.fullRoute?{fullRoute:{...route.fullRoute,lineLabels:matchRailLineNames(route.fullRoute,lines)}}:{})};
}

export function railLineAnnotations(labels,viewport,width,height,occupied=[],limit=20) {
  if (limit <= 0) return [];
  const unit=1000/viewport.zoom/width,seen=new Set(),boxes=[];
  const screen=point=>[(point[0]-viewport.x)/unit+width/2,(point[1]-viewport.y)/unit+height/2];
  for(const row of occupied)if(Array.isArray(row))boxes.push(row);else if(row.label){const [x,y]=screen(row.point),{dx,dy,fontSize}=row.label;boxes.push([x+dx-4,y+dy-fontSize-3,x+dx+row.name.length*fontSize+4,y+dy+5]);}
  const candidates=labels.map(row=>{const point=railMapPoint(row.coordinates);point[0]+=Math.round((viewport.x-point[0])/1000)*1000;return {...row,point};}).sort((a,b)=>Math.hypot(a.point[0]-viewport.x,a.point[1]-viewport.y)-Math.hypot(b.point[0]-viewport.x,b.point[1]-viewport.y));
  const result=[];
  for(const row of candidates){
    if(seen.has(row.name))continue;
    const [x,y]=screen(row.point),textWidth=row.name.length*12;
    if(x<0||x>width||y<0||y>height)continue;
    for(const [dx,dy]of [[8,-14],[8,22],[-textWidth-8,-14],[-textWidth-8,22]]){
      const box=[x+dx-3,y+dy-15,x+dx+textWidth+3,y+dy+5];
      if(box[0]<6||box[1]<6||box[2]>width-6||box[3]>height-6||boxes.some(other=>box[0]<other[2]&&box[2]>other[0]&&box[1]<other[3]&&box[3]>other[1]))continue;
      boxes.push(box);seen.add(row.name);result.push({...row,label:{dx,dy,fontSize:12,box}});break;
    }
    if(result.length>=limit)break;
  }
  return result;
}
