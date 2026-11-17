"""Re-encode the existing, calibrated fonts for Flutter without changing outlines."""
from pathlib import Path
import json
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = Path(__file__).resolve().parents[1]
FONTS = {
    'UiSans': 'ticket-hei', 'TicketHei': 'ticket-hei',
    'TicketSong': 'ticket-song', 'TicketFang': 'ticket-fang',
    'TicketRailFallback': 'ticket-rail-fallback',
    'TicketRailHei': 'ticket-rail-hei', 'TicketRailSerif': 'ticket-rail-serif',
    'TicketRailNarrow': 'ticket-rail-narrow', 'TicketRailPinyin': 'ticket-rail-pinyin',
    'TicketDateNumber': 'ticket-date-numbers', 'TicketDateLabel': 'ticket-date-labels',
    'TicketOCR': 'ticket-ocr-v2', 'TicketLatin': 'ticket-latin',
    'TicketMono': 'ticket-mono', 'TicketArabic': 'ticket-arabic',
}
target = ROOT / 'apps/flutter/assets/fonts'
target.mkdir(parents=True, exist_ok=True)
registry = {}
converted = set()
for family, source in FONTS.items():
    name = source + '.ttf'
    registry[family] = name
    if source not in converted:
        font = TTFont(ROOT / 'public/fonts' / (source + '.woff2'))
        font.flavor = None
        font.save(target / name)
        converted.add(source)
(target / 'registry.json').write_text(json.dumps(registry, indent=2) + '\n', encoding='utf-8')
brand_font=TTFont(ROOT / 'public/fonts/ticket-song.woff2')
subsetter=subset.Subsetter()
subsetter.populate(text='行迹')
subsetter.subset(brand_font)
brand_font.flavor=None
brand_font.save(target / 'brand-song.ttf')
print('Prepared exact ticket font outlines and Flutter family registry.')
