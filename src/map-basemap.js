import { LAND_PATH, COUNTRY_PATH, PROVINCE_PATH } from './data/map-reference.js';

const compiled = new WeakMap();
const tolerances = [0, .04, .15, .5];
function distanceSquared(point, start, end) {
  const dx=end[0]-start[0],dy=end[1]-start[1],length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((point[0]-start[0])*dx+(point[1]-start[1])*dy)/length)):0;
  return (point[0]-start[0]-t*dx)**2+(point[1]-start[1]-t*dy)**2;
}
function simplify(points, tolerance) {
  if(points.length<3)return points;
  const keep=new Set([0,points.length-1]),pending=[[0,points.length-1]],limit=tolerance*tolerance;
  while(pending.length){
    const [start,end]=pending.pop();let farthest=limit,index=-1;
    for(let i=start+1;i<end;i++){const distance=distanceSquared(points[i],points[start],points[end]);if(distance>farthest){farthest=distance;index=i;}}
    if(index>=0){keep.add(index);pending.push([start,index],[index,end]);}
  }
  return [...keep].sort((a,b)=>a-b).map(index=>points[index]);
}
export function simplifyMapPath(path, tolerance) {
  if(!tolerance)return path;
  const parts=[];let points=[];
  const finish=closed=>{if(points.length){const result=simplify(points,tolerance);parts.push('M'+result[0]+result.slice(1).map(point=>'L'+point).join('')+(closed?'Z':''));points=[];}};
  for(const [,command,coordinates] of path.matchAll(/([MLZ])([^MLZ]*)/g)){
    if(command==='M')finish(false);
    if(command==='Z'){finish(true);continue;}
    const values=coordinates.trim().split(/[ ,]+/).map(Number);
    for(let i=0;i+1<values.length;i+=2)points.push([values[i],values[i+1]]);
  }
  finish(false);return parts.join('');
}
function pathsFor(Path) {
  if(!compiled.has(Path))compiled.set(Path,new Map());
  const cache=compiled.get(Path);
  return tolerance=>{
    if(!cache.has(tolerance))cache.set(tolerance,[LAND_PATH,COUNTRY_PATH,PROVINCE_PATH].map(path=>new Path(simplifyMapPath(path,tolerance))));
    return cache.get(tolerance);
  };
}
export function createMapBasemap(canvas, view=window, { provinceContrast = false } = {}) {
  if(!canvas||typeof view.Path2D!=='function')return null;
  const context=canvas.getContext('2d',{desynchronized:true});if(!context)return null;
  const paths=pathsFor(view.Path2D);
  return {
    draw(viewport,width,height,interactive=false){
      const pixelRatio=Math.min(2,view.devicePixelRatio||1),scale=width*viewport.zoom/1000,viewWidth=1000/viewport.zoom;
      const bitmapWidth=Math.round(width*pixelRatio),bitmapHeight=Math.round(height*pixelRatio);
      if(canvas.width!==bitmapWidth||canvas.height!==bitmapHeight){canvas.width=bitmapWidth;canvas.height=bitmapHeight;}
      context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,canvas.width,canvas.height);
      context.setTransform(pixelRatio*scale,0,0,pixelRatio*scale,pixelRatio*(width/2-viewport.x*scale),pixelRatio*(height/2-viewport.y*scale));
      // During a gesture, omit only subpixel bends; restore full detail when it ends.
      const tolerance=interactive?[...tolerances].reverse().find(value=>value*scale<=1):0;
      const [land,countries,provinces]=paths(tolerance);
      const first=Math.floor((viewport.x-viewWidth/2)/1000),last=Math.floor((viewport.x+viewWidth/2)/1000);
      for(let copy=first;copy<=last;copy++){
        context.save();context.translate(copy*1000,0);
        context.globalAlpha=1;context.fillStyle='#24435a';context.strokeStyle='#486379';context.lineWidth=.65/scale;context.fill(land,'evenodd');context.stroke(land);
        context.globalAlpha=.82;context.strokeStyle='#8199aa';context.lineWidth=1.05/scale;context.stroke(countries);
        context.globalAlpha=provinceContrast ? .95 : .66;context.strokeStyle=provinceContrast?'#a4bac9':'#526d80';context.lineWidth=(provinceContrast?1.25:.8)/scale;
        if(provinceContrast)context.setLineDash([5/scale,3/scale]);
        context.stroke(provinces);
        context.restore();
      }
    }
  };
}
