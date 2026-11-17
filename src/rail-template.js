import { DEFAULT_RAIL_TEMPLATE } from './model.js';

export function railTemplateFromText(text = '') {
  if (/退票(?:手续)?费/.test(text.replace(/\s/g, ''))) return 'rail-refund-receipt';
  if (/报销|凭证|仅供/.test(text)) return 'rail-receipt';
  if (/经典红票|2015\s*年前/.test(text)) return 'rail-red-classic';
  if (/红色软纸票|红票/.test(text)) return 'rail-red';
  if (/磁介质|蓝票/.test(text)) return 'rail-blue';
  return DEFAULT_RAIL_TEMPLATE;
}
