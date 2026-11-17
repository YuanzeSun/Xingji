"""Build the Arabic fallback for international airport names. Requires fonttools[woff]."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
import re
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1] / 'public/fonts'
css_url = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400&display=swap'
css = urlopen(Request(css_url, headers={'User-Agent': 'Xingji font reference preparation'}), timeout=30).read().decode()
url = re.search(r'src: url\((https://fonts.gstatic.com/[^)]+)\)', css)[1]
source = urlopen(url, timeout=30).read()
font = TTFont(BytesIO(source), recalcTimestamp=False)
if 'fvar' in font:
    instantiateVariableFont(font, {axis.axisTag: 400 if axis.axisTag == 'wght' else axis.defaultValue for axis in font['fvar'].axes}, inplace=True)
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
options.layout_features = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=[32, 0x200c, 0x200d, *range(0x600, 0x700), *range(0x750, 0x780), *range(0x8a0, 0x900), *range(0xfb50, 0xfe00), *range(0xfe70, 0xff00)])
subsetter.subset(font)
for name_id, value in {1:'Xingji Ticket Arabic',2:'Regular',3:'Xingji Ticket Arabic 1.0',4:'Xingji Ticket Arabic',6:'XingjiTicketArabic-Regular',16:'Xingji Ticket Arabic',17:'Regular'}.items():
    font['name'].removeNames(nameID=name_id)
    font['name'].setName(value, name_id, 3, 1, 0x409)
font.flavor = 'woff2'
font.save(root / 'ticket-arabic.woff2')
license_url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansarabic/OFL.txt'
license_text = '\n'.join(line.rstrip() for line in urlopen(license_url, timeout=30).read().decode().splitlines()) + '\n'
notice = f'Xingji Ticket Arabic: renamed Arabic subset of Noto Sans Arabic.\nSource: {url}\nOriginal SHA-256: {sha256(source).hexdigest()}\nOriginal copyright records are retained.\n\n'
(root / 'OFL-NotoSansArabic.txt').write_text(notice + license_text, encoding='utf-8')
print('Prepared Arabic fallback:', (root / 'ticket-arabic.woff2').stat().st_size)
