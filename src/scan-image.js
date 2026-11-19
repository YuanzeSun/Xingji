import { railPaperFromPixels, railPaperHue } from './rail-template.js';

export function railPhotoColor(image) {
  const canvas = document.createElement('canvas');
  canvas.width = 72; canvas.height = 48;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return railPaperFromPixels(context.getImageData(7, 7, 58, 34).data);
}

export function cropColoredRailPaper(canvas) {
  const crop = paperCrop(canvas);
  if (!crop) return null;
  const clipped = cropCanvas(canvas, crop);
  if (Math.abs(crop.angle) < .035) return clipped;
  const rotated = document.createElement('canvas');
  const sin = Math.abs(Math.sin(crop.angle)), cos = Math.cos(crop.angle);
  rotated.width = Math.ceil(clipped.width * cos + clipped.height * sin);
  rotated.height = Math.ceil(clipped.height * cos + clipped.width * sin);
  const context = rotated.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, rotated.width, rotated.height);
  context.translate(rotated.width / 2, rotated.height / 2);
  context.rotate(-crop.angle);
  context.drawImage(clipped, -clipped.width / 2, -clipped.height / 2);
  const corrected = paperCrop(rotated);
  return corrected ? cropCanvas(rotated, corrected) : rotated;
}

function cropCanvas(canvas, crop) {
  const clipped = document.createElement('canvas');
  clipped.width = Math.ceil(crop.w); clipped.height = Math.ceil(crop.h);
  clipped.getContext('2d').drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, clipped.width, clipped.height);
  return clipped;
}

function paperTilt(positions, width, left, right, pixelRatio) {
  const upper = Array(width).fill(Infinity), lower = Array(width).fill(-Infinity);
  for (const index of positions) {
    const x = index % width, y = Math.floor(index / width);
    upper[x] = Math.min(upper[x], y); lower[x] = Math.max(lower[x], y);
  }
  const start = Math.round(left + (right - left) * .2), end = Math.round(right - (right - left) * .2);
  const slopes = [];
  for (const edge of [upper, lower]) {
    const fits = [];
    for (let x = start; x < end; x++) {
      const next = x + Math.round((end - start) * .5);
      if (next <= end && Number.isFinite(edge[x] + edge[next])) fits.push((edge[next] - edge[x]) / (next - x));
    }
    if (fits.length < 8) return 0;
    fits.sort((a, b) => a - b);
    slopes.push(fits[Math.floor(fits.length / 2)]);
  }
  const angle = Math.atan((slopes[0] + slopes[1]) / 2 * pixelRatio);
  return Math.abs(slopes[0] - slopes[1]) * pixelRatio < .15 && Math.abs(angle) < .4 ? angle : 0;
}

function paperCrop(canvas) {
  const width = 96, height = 96;
  const thumbnail = document.createElement('canvas');
  thumbnail.width = width; thumbnail.height = height;
  const context = thumbnail.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const hues = { blue: [], red: [] };
  for (let i = 0; i < width * height; i++) {
    const hue = railPaperHue(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    if (hue) hues[hue].push(i);
  }
  for (const positions of [hues.blue, hues.red].sort((a, b) => b.length - a.length)) {
    if (positions.length < width * height * .09) continue;
    const xs = positions.map(i => i % width).sort((a, b) => a - b);
    const ys = positions.map(i => Math.floor(i / width));
    const a = Math.floor(positions.length * .04), b = positions.length - 1 - a;
    const x = Math.max(0, xs[a] - 4), y = Math.max(0, ys[a] - 4);
    const w = Math.min(width, xs[b] + 5) - x, h = Math.min(height, ys[b] + 5) - y;
    const aspect = w / h * canvas.width / canvas.height;
    if (aspect < 1.12 || aspect > 2.4 || positions.length < w * h * .43 || w * h > width * height * .89) continue;
    return { x: x * canvas.width / width, y: y * canvas.height / height,
      w: w * canvas.width / width, h: h * canvas.height / height,
      angle: paperTilt(positions, width, xs[a], xs[b], canvas.height / canvas.width) };
  }
  return null;
}

export function prepareScanImage(source, type = 'rail') {
  const canvas = source.ownerDocument.createElement('canvas');
  canvas.width = Math.min(1800, Math.max(1280, source.width * 2)); canvas.height = Math.round(canvas.width * source.height / source.width);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (type === 'flight') return canvas;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height), histogram = new Uint32Array(256), gray = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < gray.length; i++) { gray[i] = Math.round(image.data[i * 4] * .299 + image.data[i * 4 + 1] * .587 + image.data[i * 4 + 2] * .114); histogram[gray[i]]++; }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * histogram[i];
  let weight = 0, partial = 0, best = -1, threshold = 145;
  for (let i = 0; i < 255; i++) {
    weight += histogram[i]; partial += i * histogram[i]; if (!weight || weight === gray.length) continue;
    const variance = weight * (gray.length - weight) * (partial / weight - (sum - partial) / (gray.length - weight)) ** 2;
    if (variance > best) { best = variance; threshold = i; }
  }
  threshold = Math.max(90, Math.min(185, threshold));
  for (let i = 0; i < gray.length; i++) { const value = gray[i] > threshold ? 255 : 0; image.data[i * 4] = value; image.data[i * 4 + 1] = value; image.data[i * 4 + 2] = value; image.data[i * 4 + 3] = 255; }
  ctx.putImageData(image, 0, 0); return canvas;
}

export async function prepareRailPhoto(source) {
  const bitmap = source instanceof Blob ? await createImageBitmap(source) : source;
  try {
    const width = bitmap.width || bitmap.naturalWidth, height = bitmap.height || bitmap.naturalHeight;
    if (!width || !height) return null;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1800 / width, 3000 / height);
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return prepareScanImage(canvas);
  } finally { if (bitmap !== source) bitmap.close(); }
}

export async function prepareOCRImage(source) {
  const bitmap=source instanceof Blob?await createImageBitmap(source):source;
  try {
    const width=bitmap.width||bitmap.naturalWidth,height=bitmap.height||bitmap.naturalHeight;
    if(!width||!height)throw new Error('图片无法读取');
    const scale=Math.min(2,1800/width,3000/height),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return canvas;
  }finally{if(bitmap!==source)bitmap.close();}
}
