"""Zet de screenshots in een browservenster. Leest bron/shots/, schrijft bron/kader/."""
import glob, os
HIER = os.path.dirname(os.path.abspath(__file__))
os.chdir(HIER)
from PIL import Image, ImageDraw, ImageFilter, ImageFont
os.makedirs('kader', exist_ok=True)
FONTS = os.path.join(HIER, '..', '..', '..', 'web', 'src', 'assets', 'fonts')
F = ImageFont.truetype(os.path.join(FONTS, 'AreaNormal-Regular.otf'), 26)
def rr(size, r):
    m = Image.new('L', size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0]-1, size[1]-1), r, fill=255); return m
for f in sorted(glob.glob('shots/*.png')):
    s = Image.open(f).convert('RGB'); w, h = s.size
    bar, bez, pad = 64, 18, 40
    W, H = w + 2*bez, h + bar + 2*bez
    win = Image.new('RGB', (W, H), '#1f2321')
    d = ImageDraw.Draw(win)
    # browserbalk
    d.rectangle((bez, bez, bez + w, bez + bar), fill='#e6e4df')
    for i, c in enumerate(['#ff5f57', '#febc2e', '#28c840']):
        x = bez + 34 + i*30; d.ellipse((x-9, bez+bar//2-9, x+9, bez+bar//2+9), fill=c)
    ux = bez + 150; d.rounded_rectangle((ux, bez+14, bez + w - 150, bez + bar - 14), 18, fill='#f8f7f4')
    d.text((ux + 24, bez + bar//2), 'marketing-nbc.github.io/designaanvraag', fill='#555', font=F, anchor='lm')
    win.paste(s, (bez, bez + bar))
    mask = rr((W, H), 36)
    out = Image.new('RGB', (W + 2*pad, H + 2*pad), 'white')
    sh = Image.new('L', out.size, 0); sh.paste(Image.new('L', (W, H), 70), (pad, pad + 10), mask); sh = sh.filter(ImageFilter.GaussianBlur(16))
    out.paste(Image.new('RGB', out.size, '#000'), (0, 0), sh)
    out.paste(win, (pad, pad), mask)
    out = out.resize((out.width * 1400 // out.width, out.height * 1400 // out.width), Image.LANCZOS)
    out.save('kader/' + os.path.basename(f)[:-4] + '.jpg', quality=90)
print(len(glob.glob('kader/*.jpg')), 'beelden')
