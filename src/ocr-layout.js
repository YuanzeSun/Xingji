// TSV contains word coordinates even when OCR puts separate columns in the wrong reading order.
export function ocrWords(tsv = '') {
  return tsv.split('\n').map(line => line.split('\t')).filter(row => row[0] === '5' && row.length >= 12).map(row => ({
    text: row.slice(11).join('\t').trim(), left: +row[6], top: +row[7], width: +row[8], height: +row[9], confidence: +row[10]
  })).filter(word => word.text && [word.left, word.top, word.width, word.height].every(Number.isFinite) && word.width > 0 && word.height > 0);
}

export function railTimeWords(tsv, service) {
  const words = ocrWords(tsv), train = words.find(word => word.text.replace(/\s/g, '').toUpperCase() === service);
  if (!train) return [];
  const times = words.filter(word => /^(?:\d|[0OIl]){1,2}[:：](?:\d|[0OIl]){2}$/.test(word.text) && Math.abs(word.top + word.height / 2 - train.top - train.height / 2) < Math.max(train.height * 5, word.height * 3));
  const rows = [];
  for (const word of times.sort((a, b) => a.top - b.top)) {
    const row = rows.find(row => Math.abs(row[0].top + row[0].height / 2 - word.top - word.height / 2) < Math.max(row[0].height, word.height) * .65);
    if (row) row.push(word); else rows.push([word]);
  }
  const pair = rows.filter(row => row.length === 2).sort((a, b) => Math.abs(a[0].top - train.top) - Math.abs(b[0].top - train.top))[0];
  return pair ? pair.sort((a, b) => a.left - b.left) : [];
}

export function railRouteAreas(tsv, service) {
  const words = ocrWords(tsv), train = words.find(word => word.text.replace(/\s/g, '').toUpperCase() === service);
  if (!train) return null;
  const row = words.filter(word => Math.min(word.top + word.height, train.top + train.height) - Math.max(word.top, train.top) > Math.min(word.height, train.height) * .2);
  const text = words => words.sort((a, b) => a.left - b.left).map(word => word.text.replace(/[^\u3400-\u9fff]/g, '')).join('');
  return { origin: text(row.filter(word => word.left + word.width < train.left)), destination: text(row.filter(word => word.left > train.left + train.width)) };
}
