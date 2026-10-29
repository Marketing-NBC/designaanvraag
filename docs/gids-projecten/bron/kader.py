"""Zet de screenshots in een Windows-venster. Leest bron/shots/, schrijft bron/kader/.

Bewust geen herkenbare browser: een titelbalk met de knoppen minimaliseren, maximaliseren en
sluiten, en een adresbalk. De mail krijgt alleen de titelbalk.
"""
import glob, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HIER = os.path.dirname(os.path.abspath(__file__))
os.chdir(HIER)
os.makedirs('kader', exist_ok=True)
FONTS = os.path.join(HIER, '..', '..', '..', 'web', 'src', 'assets', 'fonts')
F = ImageFont.truetype(os.path.join(FONTS, 'AreaNormal-Regular.otf'), 26)
URL = 'marketing-nbc.github.io/designaanvraag'
INKT, LIJN = '#262626', '#bdbdbd'


def masker(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), r, fill=255)
    return m


def titelbalk(d, x0, y0, w, h, titel):
    d.rectangle((x0, y0, x0 + w, y0 + h), fill='#f3f3f3')
    # Een neutraal paginapictogram en de titel
    d.rounded_rectangle((x0 + 26, y0 + h // 2 - 13, x0 + 52, y0 + h // 2 + 13), 6, fill='#229d96')
    d.text((x0 + 68, y0 + h // 2), titel, fill=INKT, font=F, anchor='lm')
    # Minimaliseren, maximaliseren, sluiten
    bw = 92
    for i, soort in enumerate(('min', 'max', 'sluit')):
        cx = x0 + w - bw * (2 - i) - bw // 2
        cy = y0 + h // 2
        if soort == 'min':
            d.line((cx - 10, cy, cx + 10, cy), fill=INKT, width=2)
        elif soort == 'max':
            d.rectangle((cx - 9, cy - 9, cx + 9, cy + 9), outline=INKT, width=2)
        else:
            d.line((cx - 10, cy - 10, cx + 10, cy + 10), fill=INKT, width=2)
            d.line((cx - 10, cy + 10, cx + 10, cy - 10), fill=INKT, width=2)


def adresbalk(d, x0, y0, w, h):
    d.rectangle((x0, y0, x0 + w, y0 + h), fill='#f9f9f9')
    d.line((x0, y0 + h, x0 + w, y0 + h), fill='#e0e0e0', width=2)
    cy = y0 + h // 2
    # Terug, vooruit, vernieuwen
    for i, pijl in enumerate(('<', '>')):
        cx = x0 + 40 + i * 56
        r = 1 if pijl == '>' else -1
        d.line((cx - 10 * r, cy, cx + 10 * r, cy), fill='#5f5f5f', width=3)
        d.line((cx + 10 * r, cy, cx + 2 * r, cy - 8), fill='#5f5f5f', width=3)
        d.line((cx + 10 * r, cy, cx + 2 * r, cy + 8), fill='#5f5f5f', width=3)
    cx = x0 + 152
    d.arc((cx - 11, cy - 11, cx + 11, cy + 11), 40, 330, fill='#5f5f5f', width=3)
    # Het adres
    d.rounded_rectangle((x0 + 196, y0 + 14, x0 + w - 40, y0 + h - 14), (h - 28) // 2, fill='#ffffff', outline='#dcdcdc', width=2)
    d.text((x0 + 230, cy), URL, fill='#3b3b3b', font=F, anchor='lm')


for f in sorted(glob.glob('shots/*.png')):
    naam = os.path.basename(f)[:-4]
    mail = 'mail' in naam
    s = Image.open(f).convert('RGB')
    w, h = s.size
    tb, ab, rand, pad = 72, (0 if mail else 78), 2, 40
    W, H = w + 2 * rand, h + tb + ab + 2 * rand
    venster = Image.new('RGB', (W, H), LIJN)
    d = ImageDraw.Draw(venster)
    titelbalk(d, rand, rand, w, tb, 'Klaar: Zorgcongres 2026 - Mail' if mail else 'Designaanvraag')
    if ab:
        adresbalk(d, rand, rand + tb, w, ab)
    venster.paste(s, (rand, rand + tb + ab))
    m = masker((W, H), 16)
    uit = Image.new('RGB', (W + 2 * pad, H + 2 * pad), 'white')
    schaduw = Image.new('L', uit.size, 0)
    schaduw.paste(Image.new('L', (W, H), 60), (pad, pad + 8), m)
    uit.paste(Image.new('RGB', uit.size, '#000'), (0, 0), schaduw.filter(ImageFilter.GaussianBlur(14)))
    uit.paste(venster, (pad, pad), m)
    breed = 1100 if mail else 1500
    uit = uit.resize((breed, uit.height * breed // uit.width), Image.LANCZOS)
    uit.save(f'kader/{naam}.jpg', quality=90)
print(len(glob.glob('kader/*.jpg')), 'beelden')
