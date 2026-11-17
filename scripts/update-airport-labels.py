"""Update localized airport names. Requires opencc-python-reimplemented (build only)."""
from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
from io import StringIO
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import csv
import html
import json
import re
from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
parser = ArgumentParser()
parser.add_argument('--cache-dir', type=Path, default=ROOT / '.preview/airport-name-references')
parser.add_argument('--from-cache', action='store_true')
args = parser.parse_args()
args.cache_dir.mkdir(parents=True, exist_ok=True)
query = '''SELECT ?airport ?iata ?icao ?coordinates ?english ?label WHERE {
 ?airport wdt:P238 ?iata; rdfs:label ?label.
 OPTIONAL { ?airport wdt:P239 ?icao }
 OPTIONAL { ?airport wdt:P625 ?coordinates }
 FILTER(LANG(?label) IN ("zh", "zh-hans", "zh-hant"))
 OPTIONAL { ?airport rdfs:label ?english. FILTER(LANG(?english) = "en") }
}'''
urls = {
    'airports.csv': 'https://davidmegginson.github.io/ourairports-data/airports.csv',
    'wikidata-names.json': 'https://query.wikidata.org/sparql?' + urlencode({'query': query, 'format': 'json'}),
    'caac-index.html': 'https://www.caac.gov.cn/GYMH/MHGK/MYJC/',
}
def source(name, url):
    path = args.cache_dir / name
    if not args.from_cache:
        with urlopen(Request(url, headers={'User-Agent': 'Xingji/1.0 public-airport-name-reference'}), timeout=45) as response:
            path.write_bytes(response.read())
    return path.read_text(encoding='utf-8')

with ThreadPoolExecutor(max_workers=3) as pool:
    texts = dict(zip(urls, pool.map(lambda item: source(*item), urls.items())))
last = int(re.search(r"id='pagenav_tail'[^>]+href='index_(\d+)\.html'", texts['caac-index.html'])[1])
page_urls = {f'caac-{page}.html': f'https://www.caac.gov.cn/GYMH/MHGK/MYJC/index_{page}.html' for page in range(1, last + 1)}
with ThreadPoolExecutor(max_workers=5) as pool:
    official_pages = [texts['caac-index.html'], *pool.map(lambda item: source(*item), page_urls.items())]
official = set()
for page in official_pages:
    tables = page.split('<div id="divAll">')[1].split('class="page"')[0]
    tables = re.sub(r'<!--.*?-->', '', tables, flags=re.S)
    for row in re.findall(r'<tr bgcolor="F7F7F7">(.*?)</tr>', tables, re.S):
        cell = re.search(r'<td\b[^>]*>(.*?)</td>', row, re.S)
        if cell:
            official.add(html.unescape(re.sub('<[^>]+>', '', cell[1])).strip())
if len(official) < 260:
    raise ValueError('Incomplete CAAC airport-name reference')
normalize = lambda value: re.sub(r'(?:国际|國際|机场|機場|\s)', '', value)
official_names = {normalize(name): name for name in official}
base = json.loads(re.search(r'^export const AIRPORTS = (.+);$', (ROOT / 'src/data/location-reference.js').read_text(encoding='utf-8'), re.M)[1])
base_names = {row[0]: row[3] for row in base}
airports = {row['iata_code']: row for row in csv.DictReader(StringIO(texts['airports.csv'])) if base_names.get(row['iata_code']) == row['name']}

def distance(row, coordinates):
    match = re.fullmatch(r'Point\(([-\d.]+) ([-\d.]+)\)', coordinates)
    if not match:
        return float('inf')
    lon1, lat1 = map(radians, map(float, match.groups()))
    lon2, lat2 = map(radians, [float(row['longitude_deg']), float(row['latitude_deg'])])
    value = sin((lat1 - lat2) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lon1 - lon2) / 2) ** 2
    return 12742 * asin(sqrt(min(1, value)))

groups = {}
for row in json.loads(texts['wikidata-names.json'])['results']['bindings']:
    code = row['iata']['value']
    airport = airports.get(code)
    if not airport:
        continue
    has_icao = bool(airport['icao_code'] and row.get('icao'))
    if has_icao and airport['icao_code'] != row['icao']['value']:
        continue
    if row.get('coordinates'):
        if distance(airport, row['coordinates']['value']) > (10 if has_icao else 3):
            continue
    elif row.get('english', {}).get('value', '').casefold() != airport['name'].casefold():
        continue
    groups.setdefault(code, []).append(row)
convert = OpenCC('t2s').convert
output = []
for code, rows in sorted(groups.items()):
    entities = {row['airport']['value'] for row in rows}
    if len(entities) > 1:
        matching = {row['airport']['value'] for row in rows if row.get('english', {}).get('value', '').casefold() == airports[code]['name'].casefold()}
        if len(matching) != 1:
            continue
        rows = [row for row in rows if row['airport']['value'] in matching]
    rows.sort(key=lambda row: ['zh-hans', 'zh', 'zh-hant'].index(row['label']['xml:lang']))
    originals = list(dict.fromkeys(row['label']['value'] for row in rows))
    english_names = list(dict.fromkeys(row['english']['value'] for row in rows if row.get('english')))
    # Some airport entities have a city-only label. It is neither a full airport
    # name nor a safe alias, especially in cities served by several airports.
    airport_word = r'机场|機場|空港|航空站|航空港|飞行场|飛行場|airport|aerodrome|airfield|heliport|airstrip'
    names = [name for name in dict.fromkeys([*(convert(name) for name in originals), *originals, *english_names]) if re.search(airport_word, name, re.I)]
    if not names:
        continue
    preferred = names[0]
    if airports[code]['iso_country'] == 'CN':
        matching = {official_names[normalize(name)] for name in names if normalize(name) in official_names}
        if len(matching) == 1:
            preferred = matching.pop()
    output.append([code, preferred, list(dict.fromkeys([preferred, *names]))])
if len(output) < 3000:
    raise ValueError('Localized airport reference appears incomplete')
metadata = {
    'fetchedAt': datetime.now(timezone.utc).date().isoformat(), 'count': len(output),
    'source': 'https://query.wikidata.org/', 'license': 'CC0-1.0',
    'match': 'IATA + matching ICAO where available + coordinates within 10 km (3 km without ICAO); exact English name required without coordinates; reject ambiguous entities',
    'namesSource': urls['caac-index.html'], 'namesCount': len(official),
    'query': query,
    'sha256': {name: sha256(text.encode()).hexdigest() for name, text in texts.items()},
}
content = '// Generated by scripts/update-airport-labels.py. Public factual airport names only.\n'
content += 'export const AIRPORT_NAME_REFERENCE = ' + json.dumps(metadata, ensure_ascii=False) + ';\n'
content += '// IATA, preferred localized name, verified aliases (including simplified/traditional variants).\n'
content += 'export const AIRPORT_LABELS = ' + json.dumps(output, ensure_ascii=False, separators=(',', ':')) + ';\n'
(ROOT / 'src/data/airport-labels.js').write_text(content, encoding='utf-8')
print(json.dumps({'count': len(output), 'china': sum(airports[row[0]]['iso_country'] == 'CN' for row in output), 'officialNames': len(official)}))
