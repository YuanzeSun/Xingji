"""Build rail numeral subsets and calibrate spacing. Requires fonttools[woff]."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

from fontTools import subset
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://tsukurimashou.org/files/ocr-0.3.1.zip'
with urlopen(URL, timeout=30) as response:
    archive = ZipFile(BytesIO(response.read()))
source = archive.read('ocr-0.3.1/OCRBS.ttf')
assert sha256(source).hexdigest() == '29587e27376566463c4d5a1b8dfb7792fde91cb1261b511fa10f65aed8c1f354'
font = TTFont(BytesIO(source), recalcTimestamp=False)
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
subsetter = subset.Subsetter(options=options)
subsetter.populate(text='0123456789:')
subsetter.subset(font)

# Retain OCR-B's flat terminals, diagonal 3 and open 6. Calibrate cap
# height and side bearings separately, so printed digits are tall without
# inheriting the wide spacing of the general-purpose OCR font.
glyph_set = font.getGlyphSet()
outlines = {}
for char, name in font.getBestCmap().items():
    pen = TTGlyphPen(None)
    transform = (.7, 0, 0, 1, -75, 0) if char == ord(':') else (1.075, 0, 0, 1.15, -75, 0)
    glyph_set[name].draw(TransformPen(pen, transform))
    outlines[name] = pen.glyph()
for name, glyph in outlines.items():
    font['glyf'][name] = glyph
    glyph.recalcBounds(font['glyf'])
    font['hmtx'][name] = (350 if name == font.getBestCmap()[ord(':')] else 630, glyph.xMin)

for name_id, value in {
    1: 'Xingji Date OCR', 2: 'Regular', 3: 'Xingji Date OCR 1.0',
    4: 'Xingji Date OCR', 6: 'XingjiDateOCR-Regular',
}.items():
    font['name'].removeNames(nameID=name_id)
    font['name'].setName(value, name_id, 3, 1, 0x409)
font.flavor = 'woff2'
font.save(ROOT / 'public/fonts/ticket-date-numbers.woff2')
print('Original OCRBS.ttf SHA-256:', sha256(source).hexdigest())

source = archive.read('ocr-0.3.1/OCRB.ttf')
assert sha256(source).hexdigest() == '67b11c470222c7bb4550e7d4c216fd06145a939208af77e5f946bcee53e70868'
font = TTFont(BytesIO(source), recalcTimestamp=False)
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=range(32, 127))
subsetter.subset(font)
glyph_set = font.getGlyphSet()
outlines = {}
for char, name in font.getBestCmap().items():
    # The default OCR font has wide monospaced bearings, including a whole
    # character cell for decimal points. Tighten bearings, not letterforms.
    advance = {ord('.'): 280, ord(':'): 350, ord(' '): 320}.get(char, 620)
    shift = (advance - font['hmtx'][name][0]) / 2
    pen = TTGlyphPen(None)
    glyph_set[name].draw(TransformPen(pen, (1, 0, 0, 1, shift, 0)))
    outlines[name] = (pen.glyph(), advance)
for name, (glyph, advance) in outlines.items():
    font['glyf'][name] = glyph
    glyph.recalcBounds(font['glyf'])
    font['hmtx'][name] = (advance, getattr(glyph, 'xMin', 0))
for name_id, value in {
    1: 'Xingji Ticket OCR', 2: 'Regular', 3: 'Xingji Ticket OCR 2.0',
    4: 'Xingji Ticket OCR', 6: 'XingjiTicketOCR-Regular',
}.items():
    font['name'].removeNames(nameID=name_id)
    font['name'].setName(value, name_id, 3, 1, 0x409)
font.flavor = 'woff2'
font.save(ROOT / 'public/fonts/ticket-ocr-v2.woff2')
print('Original OCRB.ttf SHA-256:', sha256(source).hexdigest())
