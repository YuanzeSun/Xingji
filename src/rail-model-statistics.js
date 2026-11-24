import { normalizeRailModel, normalizeRailPowerSupply } from './rail-details.js';
import { isEmuModel, railJourneyMatches, railText } from './rail-journey.js';

// Model designations and configuration codes, distinct from trainset numbers and power supplies.
const modelCode = /^(CR(?:H\d+[A-Z][A-Z\d]*|\d{3}[A-Z][A-Z\d]*)|(?:CJ|DJ)\d+[A-Z\d]*|25[A-Z]{1,3})(\s*-\s*[A-Z]{1,2})?(?:-\d{4})?(?:型)?/;
const variantLabel = /^(?:\s*(?:\((.+)\)|·\s*(.+)|(技术提升[型版]?|[一二三]阶段|非?统型?)))?$/;
const seriesPatterns = [
  /^(CR400(?:AF|BF))-(?:A|B|C|E|G|J|S|Z|AE|AS|AZ|BE|BS|BZ|GS|GZ)$/,
  /^(CR200J)[1-3](?:-[A-D])?$/,
  /^(CRH6[AF])-A$/,
];
const modelAliases = new Map([['CRH2C1', ['CRH2C', '一阶段']], ['CRH2C2', ['CRH2C', '二阶段']]]);
const variantAliases = new Map([
  ['技术提升', '技术提升型'], ['技术提升版', '技术提升型'],
  ['一阶', '一阶段'], ['第一阶段', '一阶段'], ['二阶', '二阶段'], ['第二阶段', '二阶段'],
  ['三阶', '三阶段'], ['第三阶段', '三阶段'], ['非统', '非统型']
]);

function modelLabels(value) {
  const text = railText(value).normalize('NFKC');
  const labels = [];
  let depth = 0, start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (!depth && '/、,;+\n'.includes(char)) {
      labels.push(text.slice(start, index));
      start = index + 1;
    }
  }
  labels.push(text.slice(start));
  return labels;
}

function classify(value, subModel = '') {
  const text = normalizeRailModel(railText(value));
  if (!text) return null;
  const match = modelCode.exec(text);
  const variantMatch = match && variantLabel.exec(text.slice(match[0].length));
  if (!variantMatch) return { code: text, label: text, series: text };
  const [, main, suffix = ''] = match;
  const [, parenthetical, annotated, compact] = variantMatch;
  const base = main + suffix.replace(/\s/g, '');
  const [code, knownVariant] = modelAliases.get(base) || [base, ''];
  const variant = railText(parenthetical || annotated || compact || knownVariant || subModel).normalize('NFKC').toUpperCase();
  const details = [...new Set(variant.split(/[,、]/).map(detail => detail.trim()).filter(Boolean)
    .map(detail => variantAliases.get(detail) || detail))];
  const label = details.length ? `${code}（${details.join('、')}）` : code;
  const series = seriesPatterns.find(pattern => pattern.test(code))?.exec(code)[1] || code;
  return { code, label, series };
}

export function railModelsForRecord(record, { railSubtypes }) {
  const saved = modelLabels(record.railModel).map(value => classify(value)).filter(Boolean);
  const trainsets = railJourneyMatches(record) ? record.railJourney.trainsets : [];
  const stocks = trainsets.map(stock => classify(stock.model, stock.subModel)).filter(Boolean);
  const models = saved.length ? saved.flatMap(model => {
    if (!railSubtypes || model.label !== model.code) return [model];
    const matches = stocks.filter(stock => stock.code === model.code);
    return matches.length ? matches : [model];
  }) : stocks;
  const supply = normalizeRailPowerSupply(railText(record.railPowerSupply));
  return new Set(models.map(model => {
    if (!railSubtypes) return model.series;
    return supply && !isEmuModel(model.code) ? `${model.label} · ${supply}` : model.label;
  }));
}
