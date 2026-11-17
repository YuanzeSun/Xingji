import {TextDecoder,TextEncoder} from 'text-encoding';
globalThis.TextDecoder??=TextDecoder;
globalThis.TextEncoder??=TextEncoder;
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
globalThis.btoa??=value=>{let result='';for(let i=0;i<value.length;i+=3){const a=value.charCodeAt(i),b=value.charCodeAt(i+1),c=value.charCodeAt(i+2),bits=(a<<16)|((b||0)<<8)|(c||0);result+=alphabet[bits>>>18&63]+alphabet[bits>>>12&63]+(i+1<value.length?alphabet[bits>>>6&63]:'=')+(i+2<value.length?alphabet[bits&63]:'=');}return result;};
globalThis.atob??=value=>{let result='',buffer=0,bits=0;for(const char of value.replace(/=+$/,'')){const n=alphabet.indexOf(char);if(n<0)throw Error('Invalid Base64');buffer=(buffer<<6)|n;bits+=6;if(bits>=8){bits-=8;result+=String.fromCharCode(buffer>>>bits&255);}}return result;};
