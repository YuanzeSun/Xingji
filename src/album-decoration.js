import {calendarDate} from './journey-date.js';
// Decorative elements use millimetres and never alter the ticket image itself.
export async function drawAlbumCover(page,title,records,{pdf,font,mm,rgb,renderText}) {
  page.drawText('X I N G J I   /   J O U R N E Y   C O L L E C T I O N',{x:mm(24),y:mm(274),font,size:8,color:rgb(.25,.39,.32)});
  page.drawLine({start:{x:mm(24),y:mm(264)},end:{x:mm(45),y:mm(264)},thickness:1.2,color:rgb(.69,.52,.33)});
  const titleImage = await pdf.embedPng(await renderText([{text:title,y:0,size:11,serif:true,wrap:true,lineHeight:14,maxLines:3}],162,46));
  page.drawImage(titleImage,{x:mm(24),y:mm(202),width:mm(162),height:mm(46)});
  const dates=records.map(record=>calendarDate(record.departureDate)).filter(Boolean).sort();
  const dateRange=dates.length ? dates[0].replaceAll('-','.')+(dates.at(-1)!==dates[0] ? ' - '+dates.at(-1).replaceAll('-','.') : '') : 'UNDATED JOURNEYS';
  page.drawText(dateRange,{x:mm(24),y:mm(183),font,size:9,color:rgb(.43,.51,.45)});
  page.drawRectangle({x:mm(24),y:mm(39),width:mm(162),height:mm(119),color:rgb(.14,.30,.27)});
  const coverNote=await pdf.embedPng(await renderText([{text:'把走过的路，留在纸上。',y:0,size:4.3,serif:true,color:'#f5f1e5'}],140,9));
  page.drawImage(coverNote,{x:mm(34),y:mm(135),width:mm(140),height:mm(9)});
  const route=[[35,73],[57,83],[72,81],[94,107],[116,98],[137,119],[174,119]];
  for(let i=1;i<route.length;i++)page.drawLine({start:{x:mm(route[i-1][0]),y:mm(route[i-1][1])},end:{x:mm(route[i][0]),y:mm(route[i][1])},thickness:1.6,color:rgb(.78,.66,.43)});
  for(const [x,y] of [route[0],route[2],route[4],route.at(-1)]){
    page.drawCircle({x:mm(x),y:mm(y),size:mm(2.2),color:rgb(.14,.30,.27),borderColor:rgb(.91,.85,.70),borderWidth:1.2});
    page.drawCircle({x:mm(x),y:mm(y),size:mm(.65),color:rgb(.91,.85,.70)});
  }
  page.drawText('COLLECTED MOMENTS / ON THE WAY',{x:mm(34),y:mm(52),font,size:7,color:rgb(.80,.83,.74)});
}

export async function drawRailNote(page,item,{pdf,mm,rgb,renderText}) {
  const note=await pdf.embedPng(await renderText([
    {text:item.record.service || '旅途留念',y:0,size:7,serif:true},
    {text:(item.record.origin || '出发地')+' → '+(item.record.destination || '到达地'),y:14,size:3.6,wrap:true,maxLines:2},
  ],75,32));
  const noteY=297-item.y-item.height/2-16;
  page.drawLine({start:{x:mm(114),y:mm(noteY+36)},end:{x:mm(126),y:mm(noteY+36)},thickness:1,color:rgb(.69,.52,.33)});
  page.drawImage(note,{x:mm(114),y:mm(noteY),width:mm(75),height:mm(32)});
}
