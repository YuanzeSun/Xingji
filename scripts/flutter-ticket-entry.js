import './flutter-runtime-polyfills.js';
import {ticketSVG,ticketDimensions} from '../src/tickets.js';
import {flutterSVG} from './flutter-svg-adapter.js';
import {registerTicketFont,outlineTicketText,setTicketStock} from './flutter-text-outlines.js';
import ticketStocks from '../apps/flutter/assets/ticket-stock-data.js';
import {layoutFontFiles} from '../src/ticket-layouts.js';
import {readArchive} from '../src/model.js';
for(const[template,image]of Object.entries(ticketStocks))setTicketStock(template,image);
export const render = json => ticketSVG(JSON.parse(json));
export const fonts = template => layoutFontFiles(template).map(([family,file])=>[family,file.replace('.woff2','.ttf')]);
export const fontManifest = template => JSON.stringify(fonts(template));
export const registerFont = (family,base64,file) => registerTicketFont(family,Uint8Array.from(atob(base64),char=>char.charCodeAt(0)),file);
export const display = json => flutterSVG(outlineTicketText(render(json),JSON.parse(json).template));
export const dimensions = json => ticketDimensions(JSON.parse(json));
export const normalizeArchive = json => {
  try { return JSON.stringify({records:readArchive(JSON.parse(json))}); }
  catch (error) { return JSON.stringify({error:error.message}); }
};
