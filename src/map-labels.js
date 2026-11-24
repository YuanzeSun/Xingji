import { escape as e } from './html.js';

export function mapLabelPlacer(viewport, width, height, boxes = []) {
  const unit = 1000 / viewport.zoom / width;
  return (row, fontSize, centered = false) => {
    const x = (row.point[0] - viewport.x) / unit + width / 2;
    const y = (row.point[1] - viewport.y) / unit + height / 2;
    const textWidth = [...row.name].reduce((sum, char) => sum + (/\p{Script=Han}/u.test(char) ? fontSize : fontSize * .65), 0)
      + (centered ? (row.name.length - 1) * 2 : 0);
    const positions = centered
      ? [[-textWidth / 2, fontSize / 2], [-textWidth / 2 - 28, fontSize / 2], [-textWidth / 2, fontSize / 2 + 24], [-textWidth / 2, fontSize / 2 - 24]]
      : [[10, -9], [-textWidth - 10, -9], [10, fontSize + 8], [-textWidth - 10, fontSize + 8]];
    for (const [dx, dy] of positions) {
      const box = [x + dx - 4, y + dy - fontSize - 3, x + dx + textWidth + 4, y + dy + 4];
      if (box[0] < 7 || box[1] < 7 || box[2] > width - 7 || box[3] > height - 7) continue;
      if (boxes.some(other => box[0] < other[2] + 4 && box[2] > other[0] - 4 && box[1] < other[3] + 4 && box[3] > other[1] - 4)) continue;
      boxes.push(box);
      return { dx, dy, fontSize, box };
    }
    return null;
  };
}

export function mapLabelText(row, unit) {
  if (!row.label) return '';
  const { dx, dy, fontSize } = row.label;
  return `<text x="${dx * unit}" y="${dy * unit}" font-size="${fontSize * unit}" stroke-width="${3 * unit}">${e(row.name)}</text>`;
}

export function geographicLabelMarkup({ provinces, cities }, unit) {
  return provinces.map(row => `<g class="route-province" transform="translate(${row.point})" style="letter-spacing:${2 * unit}px">${mapLabelText(row, unit)}</g>`).join('')
    + cities.map(row => `<g class="route-city${row.alongRoute ? ' along-route' : ''}" transform="translate(${row.point})"><circle r="${2 * unit}"/>${mapLabelText(row, unit)}</g>`).join('');
}
