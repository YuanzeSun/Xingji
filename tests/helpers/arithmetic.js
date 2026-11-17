export function answerArithmetic(root) {
  const text=root.querySelector('[data-arithmetic-question]').textContent;
  const [,left,operator,right]=text.match(/(\d+)\s*([+−×÷])\s*(\d+)/),a=Number(left),b=Number(right);
  const answer=operator==='+' ? a+b : operator==='−' ? a-b : operator==='×' ? a*b : a/b;
  root.querySelector('[name="arithmetic-answer"]').value=String(answer);
  return answer;
}
