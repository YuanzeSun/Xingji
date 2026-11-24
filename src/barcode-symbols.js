export function symbolImage(symbol, type = 'rail') {
  const quiet = type === 'rail' ? 4 : 8, maxWidth = type === 'rail' ? 1024 : 2048;
  const scale = Math.min(8, Math.floor(maxWidth / (symbol.width + quiet * 2)), Math.floor(1024 / (symbol.height + quiet * 2)));
  if (scale < 1) throw new Error('原码尺寸超出支持范围');
  const width = (symbol.width + quiet * 2) * scale, height = (symbol.height + quiet * 2) * scale, data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < symbol.height; y++) for (let x = 0; x < symbol.width; x++) if (symbol.data[y * symbol.width + x] < 128) {
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const index = (((y + quiet) * scale + dy) * width + (x + quiet) * scale + dx) * 4; data[index] = data[index + 1] = data[index + 2] = 0; }
  }
  return { data, width, height };
}

