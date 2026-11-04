"""
Maakt van de Nederlandse menuschermen (Flexibele-template-designs-V9.ai, pagina 1-5) een Engelse
variant om in Illustrator te controleren.

Per pagina: de Nederlandse tekst eruit (de blobs, het logovak en het bestek-icoon blijven vector),
de Engelse tekst erin zoals de opmaak-engine hem zet, in de echte fonts. Waar de tekst iets raakt
staat een rood kader op een eigen laag "Let op", die je in Illustrator uit kunt zetten.

  python3 worker/menu/naar-illustrator.py worker/menu/basis/bron/Flexibele-template-designs-V9.ai \
      teksten.json . worker/menu/basis/bestek-icoon.svg Menuschermen-Engels-concept.pdf

teksten.json komt uit de opmaak-engine: renderMenu({ pakket, taal: 'en', metTeksten: true }) per
pakket, met per pakket { teksten, icoon, botsingen, overloop }. Het derde argument is de map van de
repository (voor de fonts en de basisontwerpen). De uitkomst is een PDF die Illustrator opent; na
controle bewaart de ontwerper hem als .ai. Vereist: pip install pymupdf.
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

bron, tekstpad, repo, icoonpad, uitpad = sys.argv[1:6]
REPO = Path(repo)
BASIS = REPO / 'worker' / 'menu' / 'basis'
FONTS = REPO / 'web' / 'src' / 'assets' / 'fonts'
FONTBESTANDEN = {
    'Pockota-Light': 'Pockota-Light.otf',
    'Pockota-Regular': 'Pockota-Regular.otf',
    'Pockota-Medium': 'Pockota-Medium.otf',
    'AreaNormal-Hairline': 'AreaNormal-Hairline.otf',
    'AreaNormal-HairlineItalic': 'AreaNormal-HairlineItalic.otf',
    'AreaNormal-Regular': 'AreaNormal-Regular.otf',
    'AreaNormal-Semibold': 'AreaNormal-Semibold.otf',
    'AreaNormal-ExtraBold': 'AreaNormal-Extrabold.otf',
}
PAKKETTEN = ['lunch-standaard', 'lunch-basic', 'lunch-vega-standaard', 'lunch-vega-basic', 'grab-and-go']
LOGO = 'Logo opdrachtgever'

teksten = json.loads(Path(tekstpad).read_text())
icoon_svg = Path(icoonpad).read_text()

doc = pymupdf.open(bron)
doc.select(list(range(len(PAKKETTEN))))
laag = doc.add_ocg('Let op: tekst raakt iets', on=True)
# De lagen uit het Nederlandse bestand: de Engelse tekst komt op dezelfde laag als de Nederlandse.
lagen = {v['name']: k for k, v in doc.get_ocgs().items()}
TEKSTLAAG = lagen.get('Tekst', 0)
VOETLAAG = next((k for n, k in lagen.items() if n.startswith('Dieetwens')), 0)


def kleur(hexa):
    h = hexa.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


for i, pakket in enumerate(PAKKETTEN):
    page = doc[i]
    basis = json.loads((BASIS / f'{pakket}.json').read_text())
    data = teksten[pakket]

    # 1. De Nederlandse tekst eruit; het logovak blijft zoals het is.
    for blok in page.get_text('dict')['blocks']:
        for regel in blok.get('lines', []):
            for span in regel['spans']:
                if span['text'].strip() and LOGO not in span['text'] and span['text'].strip() not in LOGO:
                    page.add_redact_annot(pymupdf.Rect(span['bbox']))
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                          graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)

    # 2. Is de dieetwens-regel opgeschoven (de Engelse tekst raakte de blob), dan het icoon mee.
    oud = basis['voetregel']['icoon']
    m = re.match(r'translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+) ([\d.]+)\)', data['icoon'] or '')
    if m and abs(float(m.group(1)) - oud['x']) > 1:
        x, y = float(m.group(1)), float(m.group(2))
        r_oud = pymupdf.Rect(oud['x'] - 2, oud['y'] - 2, oud['x'] + oud['breedte'] + 2, oud['y'] + oud['hoogte'] + 2)
        page.add_redact_annot(r_oud)
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                              graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                              text=pymupdf.PDF_REDACT_TEXT_NONE)
        svg = icoon_svg.replace('<path ', f'<path fill="{oud["kleur"]}" ', 1)
        icoon = pymupdf.open(stream=svg.encode(), filetype='svg')
        icoonpdf = pymupdf.open('pdf', icoon.convert_to_pdf())
        page.show_pdf_page(pymupdf.Rect(x, y, x + oud['breedte'], y + oud['hoogte']), icoonpdf, 0, oc=VOETLAAG)

    # 3. De Engelse tekst erin, in de echte fonts.
    geladen = set()
    for t in data['teksten']:
        if t['groep'] == 'logobalk':
            continue
        alias = re.sub(r'[^A-Za-z]', '', t['font'])
        if alias not in geladen:
            page.insert_font(fontname=alias, fontfile=str(FONTS / FONTBESTANDEN[t['font']]))
            geladen.add(alias)
        page.insert_text((t['x'], t['baseline']), t['tekst'], fontname=alias, fontsize=t['grootte'],
                         color=kleur(t['kleur']), oc=VOETLAAG if t['groep'] == 'voet' else TEKSTLAAG)

    # 4. Waar het botst: een rood kader op een eigen laag.
    for b in data['botsingen'] + [o for o in data['overloop'] if isinstance(o, dict)]:
        r = pymupdf.Rect(b['x0'] - 10, b['baseline'] - b['grootte'] - 6, b['x1'] + 10, b['baseline'] + b['grootte'] * 0.35 + 6)
        page.draw_rect(r, color=(0.85, 0, 0), width=6, oc=laag)

# 5. De fonts onder hun PostScript-naam, zoals in het Nederlandse .ai-bestand. MuPDF schrijft de
#    familienaam ("Pockota Medium"); daar koppelt Illustrator de geinstalleerde fonts niet aan.
psnaam = {re.sub(r'[^A-Za-z]', '', f): f for f in FONTBESTANDEN}
for page in doc:
    for xref, _ext, soort, _basis, naam, *_ in page.get_fonts(full=True):
        if soort != 'Type0' or naam not in psnaam:
            continue
        ps = psnaam[naam]
        doc.xref_set_key(xref, 'BaseFont', f'/{ps}')
        nazaat = int(doc.xref_get_key(xref, 'DescendantFonts')[1].strip('[]').split()[0])
        doc.xref_set_key(nazaat, 'BaseFont', f'/{ps}')
        beschrijving = doc.xref_get_key(nazaat, 'FontDescriptor')[1]
        if beschrijving.endswith('R'):
            doc.xref_set_key(int(beschrijving.split()[0]), 'FontName', f'/{ps}')

doc.set_metadata({'title': 'Menuschermen Engels - concept', 'author': 'NBC Marketing'})
doc.save(uitpad, garbage=3, deflate=True)
print('klaar:', uitpad)
