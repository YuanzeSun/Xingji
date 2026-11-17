"""Subset the bundled Noto Serif SC for station characters absent from Fandol."""
from pathlib import Path
import json
import re
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
fonts = root / 'public/fonts'
reference = (root / 'src/data/location-reference.js').read_text(encoding='utf-8')
stations = json.loads(re.search(r'^export const STATIONS = (.+);$', reference, re.M)[1])
characters = {ord(char) for row in stations for char in row[0]}
# Every rail layout falls back to FandolFang, including receipts without Station/Kai.
covered = set(TTFont(fonts / 'ticket-fang.woff2').getBestCmap())
missing = characters - covered
font = TTFont(fonts / 'ticket-song.woff2', recalcTimestamp=False)
if missing - font.getBestCmap().keys():
    raise ValueError('Bundled Noto Serif does not cover all station characters')
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=missing)
subsetter.subset(font)
for name_id, value in {1:'Xingji Rail Fallback',2:'Regular',3:'Xingji Rail Fallback 1.0',4:'Xingji Rail Fallback',6:'XingjiRailFallback-Regular',16:'Xingji Rail Fallback',17:'Regular'}.items():
    font['name'].removeNames(nameID=name_id)
    font['name'].setName(value, name_id, 3, 1, 0x409)
font.flavor = 'woff2'
font.save(fonts / 'ticket-rail-fallback.woff2')
print('Prepared rail fallback:', len(missing), 'characters')
