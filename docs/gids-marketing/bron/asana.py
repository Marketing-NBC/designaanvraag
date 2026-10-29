"""Maakt de Asana- en Outlook-beelden voor de marketinggids.

Leest de screenshots uit bron/asana-origineel/ (a01.png …; niet in git: daar staan echte namen
op) en schrijft bijgesneden beelden met oranje kaders naar bron/kader/. Wat niet over het
voorbeeld-event gaat, wordt onleesbaar gemaakt. Coördinaten zijn pixels in het origineel
(1920×1152).
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HIER = os.path.dirname(os.path.abspath(__file__))
os.chdir(HIER)
os.makedirs('kader', exist_ok=True)
FONT = ImageFont.truetype(os.path.join(HIER, '..', '..', '..', 'web', 'src', 'assets', 'fonts', 'AreaNormal-Extrabold.otf'), 22)
ORANJE = '#E8590C'

# naam: (bron, uitsnede, onleesbaar, kaders)
#   uitsnede  = (links, boven, rechts, onder)
#   onleesbaar = lijst van (links, boven, rechts, onder)
#   kaders    = lijst van (nummer, (links, boven, rechts, onder)), met 'l' erachter voor het
#               nummer linksboven in plaats van rechtsboven
BEELDEN = {
    'm01-bord': ('a01', (250, 92, 1545, 850), [(1236, 306, 1530, 772)], [
        (1, (270, 244, 573, 292)), (2, (590, 244, 893, 292)), (3, (910, 244, 1213, 292)), (4, (1230, 244, 1533, 292))]),
    'm02-taak': ('a02', (1228, 140, 1905, 1010), [], [
        (1, (1238, 202, 1830, 272)), (2, (1238, 326, 1545, 358)), (3, (1240, 444, 1535, 472)),
        (4, (1244, 754, 1880, 782)), (5, (1244, 904, 1880, 932)), (6, (1244, 977, 1880, 1006))]),
    'm03-beschrijving': ('a03', (1228, 150, 1905, 900), [], [
        (1, (1238, 192, 1560, 414)), (2, (1238, 452, 1640, 542)), (3, (1238, 604, 1790, 890))]),
    'm04-huisstijl': ('a04', (1228, 185, 1905, 1015), [], [
        (1, (1238, 312, 1840, 466)), (2, (1268, 728, 1858, 1012))]),
    'm05-subtaken': ('a05', (1228, 195, 1905, 600), [], [
        (1, (1243, 243, 1882, 274)), (2, (1243, 279, 1882, 383), 'l'), (3, (1238, 455, 1680, 560))]),
    'm06-inplannen': ('a07', (900, 235, 1222, 800), [], [
        (1, (912, 246, 1212, 292)), (2, (922, 316, 1200, 786))]),
    'm07-vervaldatum': ('a11', (1228, 140, 1905, 380), [], [
        (1, (1238, 226, 1505, 258)), (2, (1238, 308, 1340, 336)), (3, (1402, 343, 1500, 372))]),
    'm08-ingepland': ('a12', (1228, 250, 1905, 385), [], [
        (1, (1240, 256, 1872, 318)), (2, (1240, 336, 1795, 380))]),
    'm09-werkplanning': ('a08', (250, 92, 1920, 1080), [(252, 300, 1828, 776), (252, 776, 1200, 1078), (1200, 820, 1828, 1078), (1510, 776, 1828, 820)], [
        (1, (1204, 780, 1508, 820))]),
    'm10-deadlines': ('a09', (250, 92, 1920, 520), [], [
        (1, (1520, 316, 1825, 354))]),
    'm11-menuscherm': ('a11', (1228, 380, 1905, 1000), [], [
        (1, (1244, 726, 1880, 757)), (2, (1244, 764, 1880, 795), 'l')]),
    'm12-menuresultaat': ('a12', (1228, 385, 1905, 990), [], [
        (1, (1272, 418, 1868, 772)), (2, (1240, 788, 1872, 985))]),
    'm13-oplevering': ('a13', (1228, 100, 1905, 960), [], [
        (1, (1240, 101, 1365, 134)), (2, (1238, 588, 1490, 698)), (3, (1238, 848, 1445, 952))]),
    'm14-oplevermail': ('a14', (1228, 560, 1905, 990), [], [
        (1, (1244, 910, 1882, 947)), (2, (1543, 613, 1682, 642), 'l'), (3, (1543, 650, 1630, 678), 'l'), (4, (1244, 952, 1882, 982))]),
    'm15-proefmail': ('a15', (636, 198, 1903, 1110), [], [
        (1, (640, 204, 1275, 234)), (2, (984, 426, 1594, 506))]),
    'm16-verstuurd': ('a19', (1228, 685, 1905, 805), [], [
        (1, (1240, 688, 1872, 752))]),
    'm17-nieuwe-oplevering': ('a20', (1228, 380, 1905, 600), [], [
        (1, (1243, 421, 1882, 452)), (2, (1243, 457, 1882, 488), 'l')]),
    'm18-klaar': ('a17', (1228, 240, 1540, 760), [], [
        (1, (1230, 244, 1533, 292)), (2, (1252, 482, 1500, 550))]),
    'm19-feedback-bord': ('a18', (250, 92, 1545, 850), [(1236, 306, 1530, 772)], [
        (1, (590, 244, 893, 292)), (2, (602, 316, 881, 766))]),
    'm20-feedback-reactie': ('a19', (1228, 805, 1905, 990), [], [
        (1, (1240, 812, 1872, 985))]),
}


def maak(naam, bron, uitsnede, weg, kaders):
    im = Image.open(f'asana-origineel/{bron}.png').convert('RGB')
    for r in weg:
        stuk = im.crop(r).filter(ImageFilter.GaussianBlur(9))
        im.paste(stuk, r[:2])
    d = ImageDraw.Draw(im)
    for n, (l, t, r, b), *_ in kaders:
        d.rounded_rectangle((l - 4, t - 4, r + 4, b + 4), 10, outline=ORANJE, width=4)
    for n, (l, t, r, b), *kant in kaders:
        x = max(l - 4, uitsnede[0] + 18) if kant == ['l'] else min(r + 4, uitsnede[2] - 18)
        cx, cy = x, max(t - 4, uitsnede[1] + 18)
        d.ellipse((cx - 16, cy - 16, cx + 16, cy + 16), fill=ORANJE, outline='white', width=3)
        d.text((cx, cy + 1), str(n), fill='white', font=FONT, anchor='mm')
    omlijst(im.crop(uitsnede)).save(f'kader/{naam}.jpg', quality=90)


def omlijst(im):
    """Dunne rand en een zachte schaduw, zoals de andere beelden."""
    pad = 24
    w, h = im.size
    uit = Image.new('RGB', (w + 2 * pad, h + 2 * pad), 'white')
    sch = Image.new('L', uit.size, 0)
    sch.paste(70, (pad, pad + 6, pad + w, pad + h + 6))
    uit.paste(Image.new('RGB', uit.size, '#000'), (0, 0), sch.filter(ImageFilter.GaussianBlur(10)))
    uit.paste(im, (pad, pad))
    ImageDraw.Draw(uit).rectangle((pad - 1, pad - 1, pad + w, pad + h), outline='#c8c8c8', width=1)
    return uit


for naam, spec in BEELDEN.items():
    maak(naam, *spec)

# De nagemaakte mails (mails.cjs) krijgen alleen de rand.
import glob
for f in sorted(glob.glob('shots/mail-*.png')):
    im = Image.open(f).convert('RGB')
    im = im.resize((1100, im.height * 1100 // im.width), Image.LANCZOS)
    omlijst(im).save('kader/' + os.path.basename(f)[:-4] + '.jpg', quality=90)
print(len(glob.glob('kader/*.jpg')), 'beelden')
