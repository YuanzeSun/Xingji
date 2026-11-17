import test from 'node:test';
import assert from 'node:assert/strict';
import {airlineNameForCode} from '../src/airline-codes.js';
import {airlineLogo} from '../src/airline-logo.js';

test('explicit carrier codes resolve passenger brands despite reused cargo and historical catalogue codes',()=>{
  for(const [code,name] of [['MF','厦门航空'],['CXA','厦门航空'],['CA','中国国际航空'],['BA','英国航空'],['LH','汉莎航空'],['SQ','新加坡航空'],['AI','印度航空'],['CZ','中国南方航空'],['JAL','日本航空'],['U2','易捷航空']])assert.equal(airlineNameForCode(code),name,code);
  assert.equal(airlineNameForCode(' mf '),'厦门航空');
  assert.equal(airlineLogo(airlineNameForCode('MF'))?.code,'MF');
  for(const code of ['','YY','MF8179','厦门航空','https://example.com'])assert.equal(airlineNameForCode(code),'');
});
