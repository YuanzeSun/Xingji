// Legacy railway ticket format, reconstructed from webview-inject's ARMv7
// libJNIEncrypt.so (eaa432dac260a209ed9b62949c60b11dad8dd36f).
// Field layout checked against Arnie97/moerail, ticket/index.html and ticket.js.

const SEED_OFFSETS = [0, 7, 13, 19];
const TICKET_MASKS = [
  "4746d05a4c2c2ad80098144e2817c7fe",
  "97bdc37021859579c1cda3426738a2d1",
  "472f7e195b2d9fae4f3106f54175d482",
  "072341aa5ef93536fe7538e476b91997",
  "e1b68c0482b7699f54fe0461c8e8fcf7",
  "0d3368882a6d4c945d7b08e0bfca6b83",
  "28b99851715f988f21d81f2e2ae09176",
  "0008b0c64ba2003c699b74f173937668",
  "4ed115a5d2fe1bf35bb335c86e373fe9",
  "b4d6b8f78118169923b61202889332ff",
  "658b88551796fdc9eef1b53746d1f459",
  "a5a880ebe1bcc8eb40e1f41314fbbd93",
  "1fb484758c877298d37d2a997409fcf6",
  "1863dc59f9f865c782358d4db98399eb",
  "28a042a47fdb0f3779f2171edf8a1f72",
  "e1b44a6096a12a9585b57d77a9b07981",
  "0963489d249b4aa49e0c02ede17c93ba",
  "2d276838a160977cad25a4f77c7773af",
  "44b39b7d54da682ed96c4ce35afca30d",
  "1f0c56d989d46a78c29e6e5b4432ecf1",
  "62252585d8dba416bfb08f19d466307c",
  "35d36f8ee80733de2f6a78772e214396",
  "9692e8589327bbaf67c9eb22bccba23d",
  "816dd4c805d6910f71859c18b6f1dfcf",
  "97dd70e5331de6886c8774f5b2b609c4",
  "97dd70e5331de6886c8774f5b2b609c4",
];

const TAIL_MASKS = [
  "e1b68c0905e954cfa7f1ba8c3901f9ee",
  "2d27687145a5be25825ddee5696ee75e",
  "0008b18c97440078d336e9e2e726ecd0",
  "4ed1134beecc961bf34d721fdc6e7fd2",
  "472f7e32b65b3f5c9e620dea82eba905",
  "072341aabd7526fe69a9f8e4ed72332e",
  "1fb484758c876ec6b74aa6572809f9ed",
  "62252585d1b7482d7f611e33a8cc60f9",
  "b4d6b8f78185110299202d20eda665fe",
  "9692e858864f775ecf93d6457997447b",
  "816dd4c80bad221ee30b38316de3bf9e",
  "35d36f8ee80e6b53c3b9713de2e2872d",
  "4746d05a4c2c2ad8013028d02f8ff38d",
  "0d3368882a6e9928baf611c17f94d707",
  "28b998510f23b8c0f9718afcd5c122ed",
  "a5a880ebe1bad0387799341314fbbd26",
  "1863dc59f9f865c7846b1a9b730733d6",
  "44b39b7d54da682ed96c4fca3671ad1a",
  "1f0c56da9e6e5b432751a9e30865d9e2",
  "658b88551796fdc3dde36ba368f938b2",
  "97bdc37021859579c1c99ce28b5b4682",
  "28a042a5b0f377b6fc578ff90b8e3ee5",
  "e1b44a6096a12b2b0b6afaef5360f302",
  "0963493a4995493c1805db36c2f92775",
  "97eb775f58872a39a3cb321da56c1389",
  "97df774c75dea52d0c6e6da0e2c50859",
];

const TICKET_STARTS = [
  28, 31, 30, 37, 36, 41, 40, 43, 42, 47, 46, 53, 52, 57, 56, 0,
];

const TICKET_STEPS = [
  3, 2, 5, 4, 7, 6, 11, 10, 13, 12, 17, 16, 19, 18, 23, 22,
];

const TAIL_STARTS = [
  29, 28, 31, 30, 37, 36, 41, 40, 43, 42, 47, 46, 53, 52, 57, 56,
];

const TAIL_STEPS = [
  3, 2, 5, 4, 7, 6, 11, 10, 13, 12, 17, 16, 19, 18, 23, 22,
];

const TICKET_SUBSTITUTION = [
  33, 22, 7, 42, 40, 32, 56, 31, 43, 2, 4, 48, 10, 3, 26, 17,
  49, 23, 27, 52, 61, 19, 35, 53, 57, 24, 60, 25, 63, 41, 37, 51,
  1, 6, 13, 39, 9, 55, 54, 29, 15, 47, 46, 62, 45, 36, 18, 16,
  21, 50, 38, 59, 58, 44, 20, 34, 12, 11, 0, 14, 5, 8, 28, 30,
];

const TAIL_SUBSTITUTION = [
  75, 12, 88, 34, 25, 63, 41, 90, 26, 46, 99, 35, 102, 67, 16, 93,
  103, 54, 62, 0, 70, 21, 74, 7, 42, 81, 8, 98, 18, 59, 115, 50,
  44, 87, 24, 32, 108, 80, 45, 107, 68, 3, 112, 47, 84, 19, 82, 36,
  117, 94, 126, 40, 22, 111, 14, 78, 15, 97, 37, 58, 113, 57, 116, 100,
  61, 13, 106, 60, 106, 6, 89, 119, 49, 120, 53, 73, 9, 28, 17, 47,
  33, 96, 71, 2, 31, 95, 69, 1, 77, 30, 101, 27, 92, 56, 83, 114,
  104, 86, 39, 85, 65, 118, 38, 124, 64, 121, 10, 125, 72, 4, 122, 55,
  23, 76, 5, 110, 51, 20, 127, 11, 123, 52, 79, 91, 43, 109, 66, 29,
];

const FIELD_GROUPS = [
  [0, 32, [[7, 3, 26, 0], [10, 3, 26, 17576], [64, 2, 10, 12]]],
  [32, 32, [[13, 3, 26, 0], [16, 3, 27, 19683], [42, 2, 10, 12]]],
  [64, 31, [[24, 2, 10, 0], [27, 2, 10, 32], [46, 1, 10, 2], [49, 1, 10, 2], [66, 2, 10, 31], [33, 4, 10, 8192]]],
  [96, 32, [[50, 7, 10, 0], [57, 1, 10, 10], [44, 2, 10, 31]]],
  [128, 32, [[19, 5, 10, 0], [29, 4, 10, 6001], [60, 4, 10, 7]]],
  [160, 20, [[48, 1, 10, 0], [47, 1, 26, 26], [26, 1, 10, 36], [58, 2, 10, 100]]],
];

const DECIMAL = '0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gb18030 = new TextDecoder('gb18030');
const dateOffsets = [42, 44, 64, 66];

function bits(value, width) {
  const result = Array(width);
  for (let i = width - 1; i >= 0; i--) {
    result[i] = Number(value & 1n);
    value >>= 1n;
  }
  return result;
}

function number(values) {
  return values.reduce((value, bit) => value * 2 + bit, 0);
}

function integer(values) {
  return values.reduce((value, bit) => value * 2n + BigInt(bit), 0n);
}

function roundKeys(serial, mask, width, starts, steps) {
  const seedBits = [1, 1];
  for (const digit of serial) seedBits.push(...bits(BigInt(digit), 4), 1);
  const doubled = [...seedBits, ...seedBits];
  const maskBits = bits(BigInt('0x' + mask), 128);
  const seed = SEED_OFFSETS.flatMap(offset => doubled.slice(offset, offset + 32))
    .map((bit, index) => bit ^ maskBits[index]);
  return starts.map((start, round) => Array.from({ length: width }, (_, i) =>
    seed[(start + i * steps[round]) % 128]));
}

const ticketSubstitute = index => TICKET_SUBSTITUTION[index];
const tailSubstitute = index => TAIL_SUBSTITUTION[index % 128] + (index >= 128 ? 2 : 0);

function roundMix(input, other, key, chunkWidth, substitute) {
  const mixed = input.map((bit, i) => bit ^ key[i]);
  const replaced = [];
  for (let i = 0; i < mixed.length; i += chunkWidth) {
    replaced.push(...bits(BigInt(substitute(number(mixed.slice(i, i + chunkWidth)))), chunkWidth));
  }
  return other.map((bit, i) => bit ^ replaced[(i + 43) % mixed.length]);
}

function decodeBits(values, keys, chunkWidth, substitute) {
  const width = values.length / 2;
  let left = values.slice(0, width), right = values.slice(width);
  for (let round = keys.length - 1; round >= 0; round--) {
    [left, right] = [right, roundMix(right, left, keys[round], chunkWidth, substitute)];
  }
  return [...right, ...left];
}

function encodeBits(values, keys, chunkWidth, substitute) {
  const width = values.length / 2;
  let left = values.slice(width), right = values.slice(0, width);
  for (const key of keys) {
    [left, right] = [roundMix(left, right, key, chunkWidth, substitute), left];
  }
  return [...left, ...right];
}

function unpackFields(values) {
  const fields = [];
  for (const [start, width, group] of FIELD_GROUPS) {
    let word = number(values.slice(start, start + width));
    for (let i = group.length - 1; i > 0; i--) {
      const [offset, , , radix] = group[i];
      fields[offset] = word % radix;
      word = Math.floor(word / radix);
    }
    fields[group[0][0]] = word;
  }
  for (const offset of dateOffsets) fields[offset]++;
  return fields;
}

function fieldDigits(value, width, alphabet) {
  const chars = Array(width);
  for (let i = width - 1; i >= 0; i--) {
    chars[i] = alphabet[value % alphabet.length];
    value = Math.floor(value / alphabet.length);
  }
  return chars;
}

const fieldAlphabet = (offset, base) => offset === 26 ? LETTERS + DECIMAL : base === 10 ? DECIMAL : (LETTERS + ' ').slice(0, base);

function ticketText(values, referenceYear) {
  const fields = unpackFields(values);
  const text = Array(68).fill('0');
  for (const [, , group] of FIELD_GROUPS) {
    for (const [offset, width, base] of group) {
      text.splice(offset, width, ...fieldDigits(fields[offset], width, fieldAlphabet(offset, base)));
    }
  }
  text[37] = values[95] ? '5' : '0';
  const saleYear = referenceYear - (referenceYear - 2009 - fields[60]) % 7;
  const departureDay = fields[42] * 31 + fields[44], saleDay = fields[64] * 31 + fields[66];
  let departureYear = saleYear;
  if (saleDay > departureDay && 371 - saleDay + departureDay <= 300) departureYear++;
  else if (saleDay < departureDay && 371 + saleDay - departureDay < 31) departureYear--;
  text.splice(38, 4, ...fieldDigits(departureYear, 4, DECIMAL));
  text.splice(60, 4, ...fieldDigits(saleYear, 4, DECIMAL));
  return text.slice(7).join('');
}

function littleEndianWords(words) {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((word, index) => view.setUint32(index * 4, word, true));
  return bytes;
}

const fixed = (value, width) => String(value).padStart(width, '0').slice(0, width);

function encryptedTail(serial, tail, prefix) {
  const input = tail.slice(0, 80).match(/.{10}/g).flatMap(value => bits(BigInt(value), 32));
  const keys = roundKeys(serial, TAIL_MASKS[prefix], 128, TAIL_STARTS, TAIL_STEPS);
  const values = decodeBits(input, keys, 8, tailSubstitute);
  const words = Array.from({ length: 8 }, (_, i) => number(values.slice(i * 32, i * 32 + 32)));
  const control = words[7], idLength = Math.floor(control / 20) % 19;
  const idType = Math.floor(control / 2) % 10 + (words[1] & 3) * 10;
  const id = fixed(idLength ? words[0] >>> 2 : 0, 9) + fixed(words[1] >>> 2, 9);
  return [idType, idLength, id, control & 1, littleEndianWords(words.slice(2, 7)),
    fixed(Math.floor(control / 380), 7)];
}

function decimalTail(tail) {
  const control = Number(tail.slice(0, 6));
  // The native ARM path uses a signed 32-bit atol for each of the five words.
  const words = tail.slice(24, 74).match(/.{10}/g).map(word => Math.min(Number(word), 0x7fffffff));
  return [Math.floor(control / 30400), Math.floor(control / 800) % 19,
    tail.slice(6, 24), Math.floor(control / 15200) & 1, littleEndianWords(words), tail.slice(74)];
}

export function decodeRailQR(payload, referenceYear) {
  if (!/^[0-9]{144}$/.test(payload) || !Number.isInteger(referenceYear)) return '';
  const prefix = Number(payload.slice(0, 2)), serial = payload.slice(2, 8), index = prefix % 26;
  const data = bits(BigInt(payload.slice(8, 63)), 180);
  const keys = roundKeys(serial, TICKET_MASKS[index], 90, TICKET_STARTS, TICKET_STEPS);
  const ticket = ticketText(decodeBits(data, keys, 6, ticketSubstitute), referenceYear);
  const tail = payload.slice(63);
  const [idType, idLength, id, hasX, name, suffix] =
    prefix < 26 ? encryptedTail(serial, tail, prefix) : decimalTail(tail);
  const end = name.indexOf(0);
  const tailText = fixed(idType, 2) + fixed(idLength, 2) + (hasX ? id.slice(0, -1) + 'X' : id)
    + gb18030.decode(end < 0 ? name : name.subarray(0, end)) + (end < 0 ? suffix : '');
  return LETTERS[index] + serial + ticket + tailText;
}

function packTicket(text) {
  const values = Array(180).fill(0);
  for (const [start, width, group] of FIELD_GROUPS) {
    let word = 0n;
    for (const [offset, length, base, radix] of group) {
      const alphabet = fieldAlphabet(offset, base);
      let value = 0;
      for (const char of text.slice(offset, offset + length)) {
        const digit = alphabet.indexOf(char);
        if (digit < 0) return null;
        value = value * alphabet.length + digit;
      }
      if (dateOffsets.includes(offset)) value--;
      if (offset === 60) value = ((value - 2009) % 7 + 7) % 7;
      if (value < 0 || (radix && value >= radix)) return null;
      word = word * BigInt(radix) + BigInt(value);
    }
    if (word >= 1n << BigInt(width)) return null;
    values.splice(start, width, ...bits(word, width));
  }
  values[95] = Number(text[37] === '5');
  return values;
}

let twoByteNames;
function nameCharacter(char) {
  const point = char.codePointAt(0);
  if (point < 128) return [point];
  if (!twoByteNames) {
    twoByteNames = new Map();
    const pair = new Uint8Array(2);
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      pair[0] = lead;
      for (let trail = 0x40; trail <= 0xfe; trail++) {
        if (trail === 0x7f) continue;
        pair[1] = trail;
        const decoded = gb18030.decode(pair);
        if (!twoByteNames.has(decoded) && decoded !== '\ufffd') twoByteNames.set(decoded, [lead, trail]);
      }
    }
  }
  if (twoByteNames.has(char)) return twoByteNames.get(char);
  const fourBytes = index => Uint8Array.of(0x81 + Math.floor(index / 12600), 0x30 + Math.floor(index / 1260) % 10,
    0x81 + Math.floor(index / 10) % 126, 0x30 + index % 10);
  if (point >= 0x10000) return fourBytes(189000 + point - 0x10000);
  // GB18030's four-byte BMP range is ordered apart from the private-use entry at 7457.
  let low = 0, high = 39419;
  while (low <= high) {
    const index = Math.floor((low + high) / 2), bytes = fourBytes(index);
    const decoded = gb18030.decode(bytes).codePointAt(0);
    if (decoded === point) return bytes;
    const ordered = index === 7457 ? gb18030.decode(fourBytes(index - 1)).codePointAt(0) + 1 : decoded;
    if (ordered < point) low = index + 1;
    else high = index - 1;
  }
  return [];
}

export function encodeRailQR(header, { identity, idType, name, time }) {
  if (header.length !== 68 || !/^[A-Z]\d{6}/.test(header)) return '';
  const index = LETTERS.indexOf(header[0]), serial = header.slice(1, 7);
  const packed = packTicket(header);
  if (!packed) return '';
  const nameBytes = [];
  for (const char of name) {
    const bytes = nameCharacter(char);
    if (!bytes.length) return '';
    nameBytes.push(...bytes);
  }
  if (nameBytes.length > 20) return '';
  const paddedName = new Uint8Array(20).fill(32);
  paddedName.set(nameBytes);
  if (gb18030.decode(paddedName).trim() !== name) return '';
  const nameWords = new DataView(paddedName.buffer);
  const numericId = identity.replace(/X$/, '0').padStart(18, '0');
  // Only HHmm is represented on the editor. The final three suffix digits are unset.
  const control = Number(time.replace(':', '') + '000') * 380 + identity.length * 20 + idType % 10 * 2 + Number(identity.endsWith('X'));
  const words = [Number(numericId.slice(0, 9)) * 4, Number(numericId.slice(9)) * 4 + Math.floor(idType / 10)];
  for (let offset = 0; offset < 20; offset += 4) words.push(nameWords.getUint32(offset, true));
  words.push(control);

  const ticketKeys = roundKeys(serial, TICKET_MASKS[index], 90, TICKET_STARTS, TICKET_STEPS);
  const ticket = integer(encodeBits(packed, ticketKeys, 6, ticketSubstitute)).toString().padStart(55, '0');
  const tailKeys = roundKeys(serial, TAIL_MASKS[index], 128, TAIL_STARTS, TAIL_STEPS);
  const tail = encodeBits(words.flatMap(word => bits(BigInt(word), 32)), tailKeys, 8, tailSubstitute);
  let encrypted = '';
  for (let offset = 0; offset < tail.length; offset += 32) encrypted += fixed(number(tail.slice(offset, offset + 32)), 10);
  return fixed(index, 2) + serial + ticket + encrypted + '0';
}
