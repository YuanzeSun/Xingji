// White app-header text and dark card text need opposite contrast treatment.
export function flightScreenshotPixels(image, whiteThreshold=165) {
  const {width,height,data}=image;
  for(let y=0;y<height;y++){
    let colored=0;
    for(let x=0;x<width;x++){const i=(y*width+x)*4,min=Math.min(data[i],data[i+1],data[i+2]),max=Math.max(data[i],data[i+1],data[i+2]);if(max-min>55&&min<175)colored++;}
    const inverted=colored/width>.35;
    for(let x=0;x<width;x++){const i=(y*width+x)*4,min=Math.min(data[i],data[i+1],data[i+2]),value=inverted?(min>whiteThreshold?0:255):(min<220?0:255);data[i]=data[i+1]=data[i+2]=value;data[i+3]=255;}
  }
  return image;
}
export async function prepareFlightScreenshot(source, {preserveEdges=true}={}) {
  const bitmap=source instanceof Blob?await createImageBitmap(source):source;
  try {
    const width=bitmap.width||bitmap.naturalWidth,height=bitmap.height||bitmap.naturalHeight;
    if(!width||!height)return null;
    const scale=Math.min(3,Math.max(1,preserveEdges?Math.ceil(1000/width):1200/width),6000/height),canvas=document.createElement('canvas');
    canvas.width=Math.round(width*(preserveEdges?Math.min(1,1800/width,6000/height):scale));canvas.height=Math.round(canvas.width*height/width);
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    context.putImageData(flightScreenshotPixels(context.getImageData(0,0,canvas.width,canvas.height),preserveEdges?165:180),0,0);
    if(!preserveEdges)return canvas;
    const enlarged=document.createElement('canvas');enlarged.width=Math.round(width*scale);enlarged.height=Math.round(height*scale);
    const enlargedContext=enlarged.getContext('2d');enlargedContext.imageSmoothingEnabled=false;enlargedContext.drawImage(canvas,0,0,enlarged.width,enlarged.height);
    return enlarged;
  } finally {if(bitmap!==source)bitmap.close();}
}
