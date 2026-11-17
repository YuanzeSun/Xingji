// Expand SVG constructs that Flutter currently interprets differently. All
// coordinates, fonts, colors, barcode paths and clipping remain unchanged.
export function flutterSVG(input) {
  const attribute=(text,name,fallback='')=>new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(text)?.[1]??fallback;
  let svg=input.replace(/<image\b([^>]*?)href="data:image\/svg\+xml;base64,([^"]+)"([^>]*?)\/>/g,(_,before,bytes,after)=>{
    const image=before+after,source=atob(bytes),root=/<svg\b([^>]*)>([\s\S]*)<\/svg>/.exec(source);
    if(!root)throw Error('Unsupported embedded SVG');
    const attrs=root[1].replace(/\s(?:width|height|x|y)="[^"]*"/g,'');
    return `<svg x="${attribute(image,'x','0')}" y="${attribute(image,'y','0')}" width="${attribute(image,'width')}" height="${attribute(image,'height')}" ${attrs}>${root[2]}</svg>`;
  });
  svg=svg.replace(/<svg\b(?=[^>]*\sx=")([^>]*)>([\s\S]*?)<\/svg>/g,(_,attrs,content)=>{
    const box=attribute(attrs,'viewBox').trim().split(/[ ,]+/).map(Number),width=+attribute(attrs,'width'),height=+attribute(attrs,'height');
    if(box.length!==4||!box[2]||!box[3])throw Error('Invalid nested SVG viewport');
    const ratio=Math.min(width/box[2],height/box[3]),x=+attribute(attrs,'x','0')+(width-box[2]*ratio)/2,y=+attribute(attrs,'y','0')+(height-box[3]*ratio)/2;
    const presentation=attrs.replace(/\s?(?:xmlns|x|y|width|height|viewBox|preserveAspectRatio|role|aria-label)="[^"]*"/g,'');
    return `<g ${presentation} transform="translate(${x} ${y}) scale(${ratio}) translate(${-box[0]} ${-box[1]})">${content}</g>`;
  });
  const patterns=new Map();
  svg=svg.replace(/<pattern\b([^>]*)>([\s\S]*?)<\/pattern>/g,(_,attrs,content)=>{
    const id=attribute(attrs,'id'),width=+attribute(attrs,'width'),height=+attribute(attrs,'height');
    patterns.set(id,{width,height});
    return `<clipPath id="${id}-tile-clip"><rect width="${width}" height="${height}"/></clipPath><g id="${id}-tile" clip-path="url(#${id}-tile-clip)">${content}</g>`;
  });
  svg=svg.replace(/<rect\b([^>]*?)fill="url\(#([^)]*)\)"([^>]*?)\/>/g,(original,before,id,after)=>{
    const pattern=patterns.get(id);if(!pattern)return original;
    const attrs=before+after,x=+attribute(attrs,'x','0'),y=+attribute(attrs,'y','0'),width=+attribute(attrs,'width'),height=+attribute(attrs,'height'),pieces=[];
    for(let row=Math.floor(y/pattern.height);row<(y+height)/pattern.height;row++)for(let col=Math.floor(x/pattern.width);col<(x+width)/pattern.width;col++)pieces.push(`<use href="#${id}-tile" transform="translate(${col*pattern.width} ${row*pattern.height})"/>`);
    return `<defs><clipPath id="${id}-surface-clip"><rect ${attrs}/></clipPath></defs><g clip-path="url(#${id}-surface-clip)">${pieces.join('')}</g>`;
  });
  return svg;
}
