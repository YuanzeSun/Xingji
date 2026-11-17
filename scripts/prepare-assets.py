"""Optional asset regeneration: pip install fonttools brotli pillow, then run this file."""
from pathlib import Path
import gzip
import sys
import urllib.request
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.preview' / 'python-deps'))
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw

def download(url, path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, path)

font = ROOT / '.preview' / 'ticket-song.ttf'
download('https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf', font)
out = ROOT / 'public' / 'fonts' / 'ticket-song.woff2'
out.parent.mkdir(parents=True, exist_ok=True)
f = TTFont(font)
instantiateVariableFont(f, {'wght': 400}, inplace=True)
f.flavor = 'woff2'
f.save(out)
sans = ROOT / '.preview' / 'ticket-hei.ttf'
download('https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf', sans)
f = TTFont(sans)
instantiateVariableFont(f, {'wght': 500}, inplace=True)
f.flavor = 'woff2'
f.save(ROOT / 'public' / 'fonts' / 'ticket-hei.woff2')
download('https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/OFL.txt', ROOT / 'public' / 'fonts' / 'OFL-NotoSansSC.txt')
for lang in ['chi_sim', 'eng']:
    target = ROOT / 'public' / 'ocr' / (lang + '.traineddata.gz')
    if not target.exists():
        raw = ROOT / '.preview' / (lang + '.traineddata')
        download(f'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/{lang}.traineddata', raw)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(gzip.compress(raw.read_bytes(), mtime=0))
for size, name, maskable in [(192, 'icon-192.png', False), (512, 'icon-512.png', False), (512, 'icon-maskable.png', True)]:
    scale = 2
    im = Image.new('RGB', (512 * scale, 512 * scale), '#173e3b')
    d = ImageDraw.Draw(im)
    def line(points, width=15): d.line([(int(x * scale), int(y * scale)) for x, y in points], fill='#f7f3e8', width=width * scale, joint='curve')
    line([(115, 175), (397, 175), (397, 230)])
    line([(397, 290), (397, 345), (115, 345), (115, 290)])
    line([(115, 230), (115, 175)])
    d.arc((367*scale, 230*scale, 427*scale, 290*scale), 90, 270, fill='#f7f3e8', width=15*scale)
    d.arc((85*scale, 230*scale, 145*scale, 290*scale), -90, 90, fill='#f7f3e8', width=15*scale)
    for y in [185, 237, 289]: line([(310, y), (310, y+23)], 12)
    line([(164, 222), (259, 222)], 13)
    line([(164, 272), (228, 272)], 13)
    path = ROOT / 'public' / 'icons' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    im.resize((size, size), Image.Resampling.LANCZOS).save(path)
print('Prepared local font, OCR models and PWA icons.')
