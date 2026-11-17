import {escape as e} from './html.js';
import {ticketSVG,ticketDimensions,exportPNG} from './tickets.js';

// A larger drawing surface keeps faces sharp when the 3D compositor magnifies them.
const radius=235,cardWidth=768,cardScale=184/cardWidth;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const nearestAngle=(angle,current)=>current+((angle-current+180)%360+360)%360-180;
export function ticketSpaceMarkup() {
  return `<section class="ticket-space" data-ticket-space aria-label="票据 3D 球体"><header class="space-heading"><div><span class="space-eyebrow">XINGJI / COLLECTION</span><h2>旅程星球</h2></div></header><div class="space-viewport" tabindex="0" role="group" aria-label="拖动或双指滑动旋转票据球体，捏合缩放，方向键切换票据"><div class="space-aurora" aria-hidden="true"></div><div class="space-floor" aria-hidden="true"></div><div class="space-world" data-space-world></div><div class="space-hint">拖动或双指滑动旋转</div></div></section>`;
}

// Keep each sphere bounded; stepping through it also reaches the other groups.
export function spaceWindow(records,focus) {
  const start=Math.floor(focus/36)*36;
  return records.slice(start,start+36).map((record,offset)=>({record,offset,index:start+offset}));
}
export function spherePoint(index,count) {
  const z=count===1 ? 1 : 1-2*index/(count-1),ring=Math.sqrt(1-z*z),angle=index*Math.PI*(3-Math.sqrt(5));
  return {x:radius*ring*Math.cos(angle),y:radius*ring*Math.sin(angle),z:radius*z};
}
function globeMarkup() {
  const meridians=Array.from({length:6},(_,i)=>`<span class="space-sphere-ring" style="transform:rotateY(${i*30}deg)"></span>`).join('');
  const latitudes=[-50,-25,0,25,50].map(degrees=>{
    const angle=degrees*Math.PI/180,r=radius*Math.cos(angle);
    return `<span class="space-sphere-ring" style="width:${r*2}px;height:${r*2}px;left:${-r}px;top:${-r}px;transform:translateY(${radius*Math.sin(angle)}px) rotateX(90deg)"></span>`;
  }).join('');
  return `<div class="space-sphere-wire" aria-hidden="true">${meridians}${latitudes}</div>`;
}

export function mountTicketSpace(root,records) {
  if(!records.length)return ()=>{};
  const frame=root.querySelector('.space-viewport'),world=root.querySelector('[data-space-world]'),win=root.ownerDocument.defaultView;
  const camera={yaw:0,pitch:0,zoom:1},pointers=new Map();
  const textures=new Set();
  let focus=0,points=[],gesture=null,suppressClick=false,disposed=false,orbitFrame=0,cameraFrame=0,textureGeneration=0,fit=1;
  function stopOrbit(){if(orbitFrame)win.cancelAnimationFrame(orbitFrame);orbitFrame=0;}
  function drawCamera() {
    world.style.transform=`rotateX(${camera.pitch}deg) rotateY(${camera.yaw}deg) scale3d(${fit*camera.zoom},${fit*camera.zoom},${fit*camera.zoom})`;
    world.style.setProperty('--face-yaw',-camera.yaw+'deg');world.style.setProperty('--face-pitch',-camera.pitch+'deg');
    const yaw=camera.yaw*Math.PI/180,pitch=camera.pitch*Math.PI/180;
    for(const point of points){
      const z=-point.x*Math.sin(yaw)+point.z*Math.cos(yaw),depth=point.y*Math.sin(pitch)+z*Math.cos(pitch);
      point.element.style.opacity=String(.26+.74*(depth/radius+1)/2);
    }
    root.dataset.zoom=String(Math.round(camera.zoom*100));
  }
  function scheduleCamera(){
    if(cameraFrame||disposed)return;
    if(win.requestAnimationFrame)cameraFrame=win.requestAnimationFrame(()=>{cameraFrame=0;if(!disposed)drawCamera();});
    else drawCamera();
  }
  function releaseTextures(){
    textureGeneration++;
    for(const url of textures)win.URL.revokeObjectURL(url);
    textures.clear();
  }
  async function loadTextures(shown,generation){
    if(!win.Image.prototype.decode||!win.URL.createObjectURL)return;
    // One high-resolution image at a time keeps decoding and memory bounded.
    for(const {record,element} of shown){
      if(disposed||generation!==textureGeneration)return;
      let url;
      try{
        const blob=await exportPNG(record,{width:1024});
        if(disposed||generation!==textureGeneration)return;
        url=win.URL.createObjectURL(blob);textures.add(url);
        const image=new win.Image();image.alt='';image.draggable=false;image.decoding='async';image.src=url;
        await image.decode();
        if(disposed||generation!==textureGeneration)return;
        element.querySelector('.space-ticket-face').replaceChildren(image);
      }catch{
        if(url){win.URL.revokeObjectURL(url);textures.delete(url);}
        // The inline face remains available if an image cannot be prepared.
      }
    }
  }
  function drawTickets() {
    releaseTextures();
    const shown=spaceWindow(records,focus);points=shown.map((item,index)=>({...item,...spherePoint(index,shown.length)}));
    world.innerHTML=globeMarkup()+points.map(({record,offset,index,x,y,z})=>{
      const {width,height}=ticketDimensions(record);
      return `<article class="ticket-card space-ticket" style="width:${cardWidth}px;left:${-cardWidth/2}px;top:${-cardWidth*height/width/2}px;transform:translate3d(${x}px,${y}px,${z}px) rotateY(var(--face-yaw,0deg)) rotateX(var(--face-pitch,0deg)) scale(${cardScale})" data-space-offset="${offset}" data-space-index="${index}"><button type="button" class="space-ticket-face" data-action="view" data-id="${e(record.id)}" tabindex="-1" aria-label="查看 ${e(record.service)} ${e(record.origin)}至${e(record.destination)}票据">${ticketSVG(record)}</button></article>`;
    }).join('');
    const tickets=world.querySelectorAll('.space-ticket');points.forEach((point,index)=>{point.element=tickets[index];});
    void loadTextures(points,textureGeneration);
  }
  function updateFocus() {
    for(const ticket of world.querySelectorAll('.space-ticket')){
      const active=Number(ticket.dataset.spaceIndex)===focus;ticket.classList.toggle('space-ticket-current',active);
      ticket.querySelector('.space-ticket-face').tabIndex=active ? 0 : -1;
    }
  }
  function orbitTo(point) {
    stopOrbit();
    const rawYaw=Math.atan2(-point.x,point.z)*180/Math.PI;
    const target={yaw:nearestAngle(rawYaw,camera.yaw),pitch:nearestAngle(Math.atan2(point.y,Math.hypot(point.x,point.z))*180/Math.PI,camera.pitch)};
    if(!win.requestAnimationFrame||win.matchMedia?.('(prefers-reduced-motion: reduce)').matches){Object.assign(camera,target);drawCamera();return;}
    const from={...camera};let started;
    const tick=time=>{
      if(disposed)return;if(started===undefined)started=time;
      const progress=Math.min(1,(time-started)/600),ease=1-(1-progress)**3;
      camera.yaw=from.yaw+(target.yaw-from.yaw)*ease;camera.pitch=from.pitch+(target.pitch-from.pitch)*ease;drawCamera();
      orbitFrame=progress<1 ? win.requestAnimationFrame(tick) : 0;
    };
    orbitFrame=win.requestAnimationFrame(tick);
  }
  const zoom=factor=>{stopOrbit();camera.zoom=clamp(camera.zoom*factor,.6,2.2);scheduleCamera();};
  function command(name) {
    if(name==='in'||name==='out')zoom(name==='in' ? 1.15 : 1/1.15);
    else if(name==='reset'){stopOrbit();Object.assign(camera,{yaw:0,pitch:0,zoom:1});scheduleCamera();}
    else if(name==='previous'||name==='next'){
      focus=(focus+(name==='next' ? 1 : -1)+records.length)%records.length;
      if(!points.some(point=>point.index===focus))drawTickets();
      updateFocus();orbitTo(points.find(point=>point.index===focus));
    }
  }
  const distance=()=>{const [a,b]=[...pointers.values()];return a&&b ? Math.hypot(a.x-b.x,a.y-b.y) : 0;};
  function down(event) {
    if(event.button>0)return;
    event.preventDefault();frame.focus({preventScroll:true});
    stopOrbit();suppressClick=false;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    gesture={x:event.clientX,y:event.clientY,yaw:camera.yaw,pitch:camera.pitch,distance:distance(),zoom:camera.zoom};
  }
  function move(event) {
    if(!pointers.has(event.pointerId)||!gesture)return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(pointers.size===1&&Math.hypot(dx,dy)<5&&!suppressClick)return;
    suppressClick=true;frame.classList.add('is-dragging');
    if(!frame.hasPointerCapture?.(event.pointerId))frame.setPointerCapture?.(event.pointerId);
    if(pointers.size>1&&gesture.distance)camera.zoom=clamp(gesture.zoom*distance()/gesture.distance,.6,2.2);
    else{camera.yaw=gesture.yaw+dx*.4;camera.pitch=gesture.pitch-dy*.3;}
    scheduleCamera();
  }
  function up(event) {
    pointers.delete(event.pointerId);
    if(pointers.size){const point=[...pointers.values()][0];gesture={...point,yaw:camera.yaw,pitch:camera.pitch,distance:0,zoom:camera.zoom};}
    else{gesture=null;frame.classList.remove('is-dragging');}
  }
  const captureClick=event=>{if(suppressClick){event.preventDefault();event.stopPropagation();suppressClick=false;}};
  const wheel=event=>{
    event.preventDefault();
    const unit=event.deltaMode===1 ? 16 : event.deltaMode===2 ? frame.clientHeight||620 : 1;
    if(event.ctrlKey||event.metaKey)zoom(Math.exp(-clamp(event.deltaY*unit,-100,100)*.006));
    else{stopOrbit();camera.yaw-=event.deltaX*unit*.35;camera.pitch+=event.deltaY*unit*.35;scheduleCamera();}
  };
  function keydown(event) {
    if(event.target.matches('input,button')||event.altKey||event.ctrlKey||event.metaKey)return;
    const commands={ArrowLeft:'previous',ArrowRight:'next','+':'in','=':'in','-':'out','0':'reset',r:'reset',R:'reset'};
    if(commands[event.key]){event.preventDefault();command(commands[event.key]);}
    else if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();stopOrbit();camera.pitch+=event.key==='ArrowUp' ? 8 : -8;scheduleCamera();}
  }
  frame.addEventListener('click',captureClick,true);
  const preventSelection=event=>event.preventDefault();
  const handlers=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up],['keydown',keydown],['selectstart',preventSelection],['dragstart',preventSelection]];
  for(const [name,handler] of handlers)frame.addEventListener(name,handler);
  frame.addEventListener('wheel',wheel,{passive:false});
  const resize=()=>{fit=Math.min(1.08,(frame.clientWidth||1000)/690,(frame.clientHeight||620)/650);scheduleCamera();};
  const observer=win.ResizeObserver ? new win.ResizeObserver(resize) : null;observer?.observe(frame);win.addEventListener('resize',resize);
  drawTickets();updateFocus();resize();
  return ()=>{
    disposed=true;stopOrbit();if(cameraFrame)win.cancelAnimationFrame(cameraFrame);releaseTextures();observer?.disconnect();win.removeEventListener('resize',resize);frame.removeEventListener('click',captureClick,true);frame.removeEventListener('wheel',wheel);
    for(const [name,handler] of handlers)frame.removeEventListener(name,handler);
    pointers.clear();
  };
}
