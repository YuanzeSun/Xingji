"""Decode the actual webfonts for resvg, retaining their CSS family aliases."""
from pathlib import Path
from hashlib import sha256
import json
import re

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
out = ROOT / '.preview/font-previews'
out.mkdir(parents=True, exist_ok=True)
css = (ROOT / 'src/styles.css').read_text(encoding='utf-8')
manifest_path = out / 'manifest.json'
previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
manifest = {}
for family, filename in re.findall(r"@font-face\{font-family:(\w+);src:url\('\.\./fonts/([^']+)'\)", css):
    digest = sha256((ROOT / 'public/fonts' / filename).read_bytes()).hexdigest()
    target = out / (family + '.otf')
    manifest[family] = digest
    if previous.get(family) == digest and target.exists():
        continue
    # Only names and encoding change, so keep the existing glyph bounds.
    font = TTFont(ROOT / 'public/fonts' / filename, recalcTimestamp=False, recalcBBoxes=False)
    for name_id in [1, 2, 3, 4, 6, 16, 17, 21, 22]:
        font['name'].removeNames(nameID=name_id)
    for name_id, value in {1: family, 2: 'Regular', 3: family, 4: family, 6: family}.items():
        font['name'].setName(value, name_id, 3, 1, 0x409)
    font.flavor = None
    font.save(target)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
