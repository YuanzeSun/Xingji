import {create} from 'fontkit';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';

const fonts=new Map(),files=new Map();
const stocks=new Map();
export const setTicketStock = (template,image) => {stocks.set(template,image);};
export function registerTicketFont(family,bytes,file=family) {
  if(!files.has(file))files.set(file,create(bytes));
  fonts.set(family,files.get(file));
}
const inherited=['font-family','font-size','font-weight','font-kerning','letter-spacing','text-anchor'];
const number=value=>Number.parseFloat(value||'0');

// Use the calibrated font's actual outlines, not a second platform's text
// shaping/spacing/opacity implementation. The original SVG remains unchanged.
export function outlineTicketText(input,template='') {
  const document=new DOMParser().parseFromString(input,'image/svg+xml');
  if(stocks.has(template)){
    const root=document.documentElement;
    const printed=[...document.getElementsByTagName('g')].find(node=>node.getAttribute('paint-order')==='stroke'&&node.hasAttribute('transform'));
    if(!printed)throw Error('Missing original ticket print layer');
    const parent=printed.parentNode;
    const image=document.createElementNS('http://www.w3.org/2000/svg','image');
    for(const[key,value]of Object.entries({width:root.getAttribute('width'),height:root.getAttribute('height'),href:stocks.get(template)}))image.setAttribute(key,value);
    for(const node of [...parent.childNodes])if(node!==printed&&node.nodeType===1&&node.localName!=='defs')parent.removeChild(node);
    parent.insertBefore(image,printed);
  }
  function walk(node,parentStyle={}) {
    if(node.nodeType!==1)return;
    const style={...parentStyle};
    for(const key of inherited)if(node.hasAttribute(key))style[key]=node.getAttribute(key);
    if(node.localName!=='text') {for(const child of [...node.childNodes])walk(child,style);return;}
    const value=node.textContent,size=number(style['font-size']||'16'),spacing=number(style['letter-spacing']);
    const families=(style['font-family']||'TicketSong').split(',').map(name=>name.trim());
    const runs=[];
    for(const character of value){
      const font=families.map(family=>fonts.get(family)).find(font=>font?.hasGlyphForCodePoint(character.codePointAt(0)));
      if(!font)throw Error(`Ticket font missing for U+${character.codePointAt(0).toString(16)}`);
      const last=runs.at(-1);if(last?.font===font)last.text+=character;else runs.push({font,text:character});
    }
    const shaped=runs.map(run=>({...run,layout:run.font.layout(run.text,{'kern':style['font-kerning']!=='none',...(spacing?{liga:false,clig:false}:{})})}));
    let width=0;
    for(const run of shaped)width+=run.layout.advanceWidth*size/run.font.unitsPerEm+run.layout.glyphs.length*spacing;
    let x=number(node.getAttribute('x')),y=number(node.getAttribute('y'));
    if(style['text-anchor']==='middle')x-=width/2;else if(style['text-anchor']==='end')x-=width;
    const group=document.createElementNS('http://www.w3.org/2000/svg','g');
    for(const attr of [...node.attributes])if(![...inherited,'x','y'].includes(attr.name))group.setAttribute(attr.name,attr.value);
    for(const run of shaped){
      const scale=size/run.font.unitsPerEm;
      for(const [index,glyph]of run.layout.glyphs.entries()){
        const position=run.layout.positions[index],path=document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d',glyph.path.transform(scale,0,0,-scale,x+position.xOffset*scale,y-position.yOffset*scale).toSVG());
        group.appendChild(path);x+=position.xAdvance*scale+spacing;y-=position.yAdvance*scale;
      }
    }
    node.parentNode.replaceChild(group,node);
  }
  walk(document.documentElement);
  return new XMLSerializer().serializeToString(document);
}
