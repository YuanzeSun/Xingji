import test from 'node:test';
import assert from 'node:assert/strict';
import {createArithmeticChallenge,checkArithmeticAnswer} from '../src/arithmetic-confirm.js';
test('destructive action challenges cover four operations with integer nonnegative answers and reject expressions',()=>{
  for(const [op,question,answer] of [[0,'8 + 3',11],[1,'8 − 3',5],[2,'8 × 3',24],[3,'24 ÷ 3',8]]){
    const values=[op,7,2],challenge=createArithmeticChallenge(()=>values.shift());
    assert.equal(challenge.question,question);assert.equal(challenge.answer,answer);
    assert.equal(checkArithmeticAnswer(challenge,String(answer)),true);
    for(const bad of ['',String(answer+1),'1+2','Infinity','0x08','-1'])assert.equal(checkArithmeticAnswer(challenge,bad),false);
  }
});
