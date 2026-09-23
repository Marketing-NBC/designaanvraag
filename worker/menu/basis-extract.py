"""Bevriest de basisontwerpen uit het Illustrator-bestand tot vaste templates.

Dit script draait EENMALIG (of opnieuw als het .ai-bestand verandert) en schrijft
per pakket twee bestanden in worker/menu/basis/:

  <pakket>.png   de achtergrond op 3840x2160 - exact de blobs uit het .ai, niets nagebouwd
  <pakket>.json  de geometrie: titel, logobalk, voetregel, kolommen en elke alinea
                 met de baseline waarop hij in het basisontwerp staat

De renderer meet daarna niets meer zelf; hij vult alleen deze vaste templates.
Dat is het hele punt: het basisontwerp is de norm, niet iets dat per run opnieuw
wordt afgeleid.

Draaien:  python3 worker/menu/basis-extract.py
"""

import json
import re
import statistics
from collections import Counter
from pathlib import Path

import pymupdf

HIER = Path(__file__).resolve().parent
BASIS = HIER / 'basis'
BRON = BASIS / 'bron' / 'Flexibele-template-designs.ai'

GOUD = (0.965, 0.631, 0.027)
ROOD = (1.0, 0.0, 0.0)
ACCENT = '#f6a107'

# Vaste teksten die bij het sjabloon horen, niet bij de menu-inhoud. De spelling van
# de eerste regel is onderweg gecorrigeerd (Dieetswens -> Dieetwens); allebei blijven
# staan zodat een ouder bestand ook nog leesbaar is.
VOET_REGELS = ('Dieetwens of allergie?', 'Dieetswens of allergie?',
               'Laat het ons team weten,', 'we helpen je graag.')
LOGO_TEKST = 'Logo opdrachtgever'

# Correcties op het Illustrator-bestand: {pakket: {'titel': (zoals het er staat, zoals het moet)}}.
# Het basisontwerp is de norm, dus hier staat op een plek wat we er bewust van laten afwijken en
# waarom. Klopt de bron al, dan meldt de extractie dat de correctie weg kan.
# De titel (Dinner) en de spelling van de voetregel zijn in V2 rechtgezet, dus daar staat
# niets meer.
CORRECTIES: dict = {}

# Losse woorden die in het ontwerp verkeerd gespeld staan. Ze worden als heel woord
# vervangen, in de tekst en in de regelval die we bewaren. Dat is nodig omdat een
# gerecht anders niet terug te vinden is in de gerechtenbibliotheek: wie het goed
# spelt vindt de verkeerd gespelde versie niet, en krijgt dan onze eigen afbreking
# in plaats van die van de ontwerper.
WOORDCORRECTIES = [
    ('lekkernije', 'lekkernijen'),   # "Dessertbuffet met zoete lekkernije" op pagina 7
    ('L”OR', 'L’OR'),                # een dubbel aanhalingsteken op pagina 10
]


def corrigeer_woorden(tekst: str, toegepast: set | None = None) -> str:
    for fout, goed in WOORDCORRECTIES:
        nieuw = re.sub(rf'\b{re.escape(fout)}\b', goed, tekst)
        if nieuw != tekst and toegepast is not None:
            toegepast.add((fout, goed))
        tekst = nieuw
    return tekst

# Pagina (1-based) -> pakketnaam. Pagina 9 is een exacte kopie van pagina 8.
#
# Pagina 10 is geen pakket maar een voorbeeld: hetzelfde viergangendiner als
# pagina 8, maar met langere gerechten, en met de hand opgelost door het
# Voorgerecht naar de linkerkolom te halen. Daar is de doorstroom over de
# kolommen op gebouwd; de test in worker/test/menu.test.mjs legt de uitkomst
# van de engine naast de baselines die daar staan.
PAKKETTEN = [
    (1, 'lunch-standaard'),
    (2, 'lunch-basic'),
    (3, 'lunch-vega-standaard'),
    (4, 'lunch-vega-basic'),
    (5, 'grab-and-go'),
    (6, 'buffet'),
    (7, 'diner-3gangen'),
    (8, 'diner-4gangen'),
]

# Pagina's die geen pakket zijn maar wel laten zien hoe een gerecht gezet hoort te
# worden. Ze leveren alleen aan de gerechtenbibliotheek: geen achtergrond, geen
# geometrie, geen eigen pakket. Zo staat een gerecht dat de ontwerper ergens heeft
# uitgewerkt overal hetzelfde op het scherm, ook als die pagina zelf nooit gebruikt
# wordt.
VOORBEELDEN = [
    (10, 'diner-4gangen p10'),
]


def hex_kleur(waarde: int) -> str:
    return f'#{waarde:06x}'


def rond(x, n=2):
    return round(float(x), n)


# ---------------------------------------------------------------- achtergrond

def rode_balk(page):
    """De rode plaatshouder voor het logo van de opdrachtgever."""
    for d in page.get_drawings():
        f = d.get('fill')
        if f and tuple(round(c, 3) for c in f) == ROOD:
            return d['rect']
    return None


def goud_rect(page):
    """Het omhullende kader van het gouden bestek-icoon in de voetregel."""
    vakken = [d['rect'] for d in page.get_drawings()
              if d.get('fill') and tuple(round(c, 3) for c in d['fill']) == GOUD]
    if not vakken:
        return None
    r = vakken[0]
    for v in vakken[1:]:
        r |= v
    return r


def icoon_pad(page) -> str:
    """Het gouden bestek-icoon als SVG-pad, genormaliseerd op zijn eigen kader.

    Het icoon blijft vectorwerk zodat het de accentkleur van de opdrachtgever kan
    aannemen; daarom zit het niet in de achtergrondplaat.
    """
    kader = goud_rect(page)
    if not kader:
        return ''
    ox, oy = kader.x0, kader.y0
    px = lambda p: f'{p.x - ox:.2f} {p.y - oy:.2f}'
    delen = []
    for d in page.get_drawings():
        f = d.get('fill')
        if not f or tuple(round(c, 3) for c in f) != GOUD:
            continue
        stuk = []
        vorig = None
        for item in d['items']:
            soort = item[0]
            if soort == 'l':
                if vorig != item[1]:
                    stuk.append(f'M {px(item[1])}')
                stuk.append(f'L {px(item[2])}')
                vorig = item[2]
            elif soort == 'c':
                if vorig != item[1]:
                    stuk.append(f'M {px(item[1])}')
                stuk.append(f'C {px(item[2])} {px(item[3])} {px(item[4])}')
                vorig = item[4]
            elif soort == 're':
                r = item[1]
                stuk.append(f'M {r.x0 - ox:.2f} {r.y0 - oy:.2f} H {r.x1 - ox:.2f} '
                            f'V {r.y1 - oy:.2f} H {r.x0 - ox:.2f} Z')
                vorig = None
            elif soort == 'qu':
                q = item[1]
                stuk.append(f'M {px(q.ul)} L {px(q.ur)} L {px(q.lr)} L {px(q.ll)} Z')
                vorig = None
        if stuk:
            delen.append(' '.join(stuk) + ' Z')
    if not delen:
        return ''
    return (f'<path fill-rule="evenodd" d="{" ".join(delen)}"/>')


def maak_achtergrond(pagina_nr: int) -> pymupdf.Pixmap:
    """Rendert de pagina met alleen de blobs: tekst, logobalk en icoon eruit.

    Op pagina 1 en 3 ligt een NBC-logo verstopt onder de rode logobalk. Dat is in
    het ontwerp onzichtbaar, dus het mag ook niet in de achtergrond opduiken.
    """
    doc = pymupdf.open(BRON)
    page = doc[pagina_nr - 1]

    balk = rode_balk(page)

    # 1. alle tekst weg, afbeeldingen en lijnwerk ongemoeid
    for blok in page.get_text('dict')['blocks']:
        if blok.get('type') != 0:
            continue
        for regel in blok['lines']:
            for span in regel['spans']:
                page.add_redact_annot(pymupdf.Rect(span['bbox']))
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                          graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)

    # 2. rode logobalk en gouden icoon weg - dat zijn sjabloon-elementen die de
    #    renderer zelf tekent (en die van kleur kunnen wisselen per opdrachtgever)
    for d in page.get_drawings():
        f = d.get('fill')
        if f and tuple(round(c, 3) for c in f) in (GOUD, ROOD):
            page.add_redact_annot(d['rect'])
    # 3. wat volledig onder de rode balk lag, was onzichtbaar en blijft onzichtbaar
    if balk:
        for info in page.get_image_info():
            r = pymupdf.Rect(info['bbox'])
            if r.is_empty:
                continue
            if r in balk:
                page.add_redact_annot(r)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_REMOVE_UNLESS_INVISIBLE,
                          graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)

    return page.get_pixmap(dpi=72, alpha=False)


# ----------------------------------------------------------------- typografie

# pymupdf kapt fontnamen af op 24 tekens, waardoor bijvoorbeeld
# AreaNormal-HairlineItalic als AreaNormal-HairlineItali binnenkomt. Zo'n naam
# matcht geen enkele @font-face en zou de tekst stilletjes in een standaardfont
# zetten, met andere breedtes tot gevolg. Daarom brengen we elke naam terug naar
# de lijst die de renderer echt kent.
BEKENDE_FONTS = (
    'Pockota-Light', 'Pockota-Regular', 'Pockota-Medium',
    'AreaNormal-Hairline', 'AreaNormal-HairlineItalic', 'AreaNormal-Thin',
    'AreaNormal-Regular', 'AreaNormal-Semibold', 'AreaNormal-ExtraBold',
)


# Illustrator zet fi/fl/ff als een enkel ligatuurteken in het bestand. In de data
# willen we gewone letters: dan matcht ingetypte tekst met het basisontwerp, en het
# font maakt bij het renderen zelf weer een ligatuur van "fl".
LIGATUREN = {
    'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl',
    'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
}


def ontligatuur(tekst: str) -> str:
    for teken, vervanging in LIGATUREN.items():
        tekst = tekst.replace(teken, vervanging)
    return tekst


def normaliseer_font(naam: str) -> str:
    naam = naam.split('+')[-1]
    if naam in BEKENDE_FONTS:
        return naam
    kandidaten = [f for f in BEKENDE_FONTS if f.startswith(naam)]
    if len(kandidaten) == 1:
        return kandidaten[0]
    raise ValueError(f'Onbekend font in het basisontwerp: {naam!r} '
                     f'(kandidaten: {kandidaten or "geen"})')


def soort_van(font: str, grootte: float, kleur: str) -> str:
    """Welke rol een tekstfragment in het ontwerp speelt."""
    if 'Pockota' in font and grootte > 150:
        return 'titel'
    if kleur == ACCENT:
        return 'kop'
    if 'ExtraBold' in font:
        return 'naam'
    return 'ingr'


def spans_van(page, toegepast=None):
    """Alle tekstfragmenten met hun exacte positie, font, grootte en kleur."""
    uit = []
    for blok in page.get_text('dict')['blocks']:
        if blok.get('type') != 0:
            continue
        for regel in blok['lines']:
            for span in regel['spans']:
                tekst = corrigeer_woorden(ontligatuur(span['text']), toegepast)
                if not tekst.strip():
                    continue
                font = normaliseer_font(span['font'])
                kleur = hex_kleur(span['color'])
                uit.append({
                    'font': font,
                    'grootte': round(span['size'], 2),
                    'kleur': kleur,
                    'x': round(span['origin'][0], 2),
                    'x1': round(span['bbox'][2], 2),
                    'baseline': round(span['origin'][1], 2),
                    'tekst': tekst,
                    'soort': soort_van(font, round(span['size'], 2), kleur),
                })
    return uit


def is_sjabloontekst(span) -> bool:
    t = span['tekst'].strip()
    return t == LOGO_TEKST or t in VOET_REGELS or any(t and r.startswith(t) and len(t) > 3 for r in VOET_REGELS)


# -------------------------------------------------------------- woordbreedtes

def woordindex(page) -> dict:
    """Woorden met hun echte breedte, gegroepeerd op de baseline waarop ze staan.

    We lezen de losse letters (rawdict) in plaats van de woordenlijst, omdat die
    laatste geen baseline meegeeft - alleen een letterkader. Woorden aan een
    baseline koppelen via dat kader gaat mis zodra kolommen naast elkaar staan:
    een woord belandt dan zomaar bij de regel van de buurkolom. De baseline van
    de span is niet te verwarren.
    """
    index = {}
    for blok in page.get_text('rawdict')['blocks']:
        if blok.get('type') != 0:
            continue
        for regel in blok['lines']:
            for span in regel['spans']:
                baseline = round(span['origin'][1], 2)
                rij = index.setdefault(baseline, [])
                huidig = None
                for teken in span['chars']:
                    if teken['c'].isspace():
                        huidig = None
                        continue
                    if huidig is None:
                        huidig = [round(teken['bbox'][0], 2), round(teken['bbox'][2], 2), teken['c']]
                        rij.append(huidig)
                    else:
                        huidig[1] = round(teken['bbox'][2], 2)
                        huidig[2] += teken['c']
    for woorden in index.values():
        woorden.sort()
    return index


def spatiebreedtes(page) -> dict:
    """Breedte van een spatie per corpsgrootte, gemeten aan de spaties zelf."""
    per_grootte = {}
    for blok in page.get_text('rawdict')['blocks']:
        if blok.get('type') != 0:
            continue
        for regel in blok['lines']:
            for span in regel['spans']:
                grootte = round(span['size'], 2)
                for teken in span['chars']:
                    if teken['c'] == ' ':
                        breedte = teken['bbox'][2] - teken['bbox'][0]
                        if breedte > 0:
                            per_grootte.setdefault(grootte, []).append(breedte)
    return {g: round(statistics.median(v), 2) for g, v in per_grootte.items()}


# ------------------------------------------------------------------ kolommen

def kolom_x(spans, tol=60):
    """De linkermarges van de kolommen, afgeleid uit koppen en gerechtnamen."""
    xs = sorted({round(s['x']) for s in spans if s['soort'] in ('kop', 'naam')})
    groepen = []
    for x in xs:
        if groepen and x - groepen[-1][-1] <= tol:
            groepen[-1].append(x)
        else:
            groepen.append([x])
    return [min(g) for g in groepen]


def regels_bouwen(spans):
    """Fragmenten op dezelfde baseline samenvoegen tot regels.

    Groeperen gebeurt op een afgeronde sleutel, maar de baseline zelf houden we op
    volle precisie: een halve punt verschil is op 4K zichtbaar.
    """
    per_baseline = {}
    for s in spans:
        per_baseline.setdefault(round(s['baseline'], 1), []).append(s)
    regels = []
    for sleutel in sorted(per_baseline):
        runs = sorted(per_baseline[sleutel], key=lambda s: s['x'])
        regels.append({'baseline': min(r['baseline'] for r in runs), 'runs': runs})
    return regels


def alineas_bouwen(regels):
    """Regels groeperen tot alinea's: een kop, een gerechtnaam of een ingredientenblok.

    Een alinea is doorlopende tekst van dezelfde soort; een nieuwe soort (of een
    nieuwe gerechtnaam) begint een nieuwe alinea. Meerregelige koppen en namen
    blijven zo netjes bij elkaar.
    """
    alineas = []
    for regel in regels:
        soort = regel['runs'][0]['soort']
        vorige = alineas[-1] if alineas else None
        zelfde = vorige is not None and vorige['soort'] == soort
        # Twee gerechtnamen onder elkaar horen alleen bij elkaar als het ontwerp
        # ze als doorloop zet; dat herkennen we aan een kleinere regelafstand dan
        # de normale afstand tussen twee losse gerechten.
        if zelfde and soort == 'naam':
            afstand = regel['baseline'] - vorige['regels'][-1]['baseline']
            grootte = regel['runs'][0]['grootte']
            zelfde = afstand < grootte * 1.25
        if zelfde and soort == 'kop':
            afstand = regel['baseline'] - vorige['regels'][-1]['baseline']
            zelfde = afstand < regel['runs'][0]['grootte'] * 1.35
        if zelfde:
            vorige['regels'].append(regel)
        else:
            alineas.append({'soort': soort, 'regels': [regel]})
    return alineas


def kaderbreedte(alineas, links: float, grens: float, index, spaties) -> dict:
    """Leidt af hoe breed het tekstkader in Illustrator was.

    Elke regel moet passen: dat geeft een harde ondergrens. Brak een regel af,
    dan paste het eerste woord van de volgende regel er net niet meer bij: dat
    geeft een bovengrens.

    Niet elke regelovergang is een automatische afbreking - de ontwerper heeft op
    plekken met de hand een regel afgebroken. Zo'n handmatige breuk levert een
    bovengrens op die onder de ondergrens duikt; die tellen we niet mee, en we
    rapporteren hoeveel het er waren.
    """
    # Regelbreedtes meten we tot de laatste letter, niet tot het einde van de span:
    # die loopt door tot en met de spatie waar de regel op afbreekt, en dat maakt
    # elke regel zo'n tien eenheden te breed.
    def woorden_van(regel):
        return [w for w in index.get(regel['baseline'], []) if links - 40 <= w[0] < grens]

    def regelbreedte(regel):
        woorden = woorden_van(regel)
        return (max(w[1] for w in woorden) - links) if woorden else 0.0

    onder = 0.0
    bovengrenzen = []
    for alinea in alineas:
        for regel in alinea['regels']:
            onder = max(onder, regelbreedte(regel))
    for alinea in alineas:
        for i, regel in enumerate(alinea['regels'][:-1]):
            volgende = alinea['regels'][i + 1]
            woorden = woorden_van(volgende)
            if not woorden:
                continue
            x0, x1, _ = woorden[0]
            spatie = spaties.get(volgende['runs'][0]['grootte'], volgende['runs'][0]['grootte'] * 0.26)
            bovengrenzen.append(regelbreedte(regel) + spatie + (x1 - x0))
    echt = [b for b in bovengrenzen if b > onder]
    handmatig = len(bovengrenzen) - len(echt)
    if not echt:
        # Geen enkele automatische afbreking in deze kolom: dan valt er niets af
        # te leiden en schatten we ruim. Dat wordt gerapporteerd, want als dit
        # gebeurt terwijl er wel afgebroken regels staan, is er iets mis.
        boven = onder + 60
    else:
        boven = min(echt)

    # Binnen dat interval kiezen we vlak boven de ondergrens, niet in het midden.
    # Elke regel die in het ontwerp heel bleef past dan nog net, en elk woord dat
    # in het ontwerp doorschoof naar de volgende regel schuift nog steeds door -
    # dat is precies wat de bovengrenzen zeggen. Een breder kader zou regels gaan
    # samenvoegen die de ontwerper had afgebroken.
    #
    # De marge erbovenop vangt op dat wij in Hairline zetten en het .ai in Thin:
    # Hairline is tot 0,75% breder, dus zonder marge zou een regel die in het
    # ontwerp nog net paste bij ons alsnog afbreken.
    marge = max(6.0, onder * 0.012)
    gekozen = onder + marge if onder + marge < boven else (onder + boven) / 2
    return {'breedte': rond(gekozen), 'minimaal': rond(onder), 'maximaal': rond(boven),
            'handmatigeAfbrekingen': handmatig}


# --------------------------------------------------------------------- ritme

def ritme_meten(per_kolom) -> dict:
    """De vaste baseline-afstanden van dit pakket.

    Per overgang (kop->naam, naam->ingr, ...) nemen we de waarde die het vaakst
    voorkomt. Waar het ontwerp met de hand is bijgesteld, staat die afwijking al
    verankerd in de alinea zelf; dit ritme geldt alleen als er herschikt moet
    worden omdat de tekst anders afbreekt.

    Overgangen worden per kolom gemeten: de sprong van de laatste alinea van de
    ene kolom naar de eerste van de volgende is geen regelafstand.
    """
    overgangen = {}
    regelafstanden = {}
    for alineas in per_kolom:
        for a, b in zip(alineas, alineas[1:]):
            sleutel = f"{a['soort']}->{b['soort']}"
            afstand = round(b['regels'][0]['baseline'] - a['regels'][-1]['baseline'], 2)
            overgangen.setdefault(sleutel, []).append(afstand)
        for alinea in alineas:
            for r1, r2 in zip(alinea['regels'], alinea['regels'][1:]):
                regelafstanden.setdefault(alinea['soort'], []).append(
                    round(r2['baseline'] - r1['baseline'], 2))
    return {
        'overgang': {k: Counter(v).most_common(1)[0][0] for k, v in overgangen.items()},
        'regelafstand': {k: Counter(v).most_common(1)[0][0] for k, v in regelafstanden.items()},
        'kopBaseline': None,
    }


def zetfouten_zoeken(kolommen) -> list:
    """Onregelmatigheden in de tekst van het basisontwerp zelf.

    Die worden bij het renderen letterlijk overgenomen - het basisontwerp is de
    norm - maar het is goed om te weten dat ze er zijn, zodat ze in het .ai-bestand
    opgeruimd kunnen worden.
    """
    uit = []
    for nr, kolom in enumerate(kolommen, start=1):
        for alinea in kolom['alineas']:
            tekst = alinea['tekst']
            if tekst.rstrip().endswith('|'):
                uit.append({'kolom': nr, 'tekst': tekst[:60],
                            'wat': 'eindigt op een los scheidingsteken'})
            if re.search(r'\S\|', tekst) or re.search(r'\|\S', tekst):
                uit.append({'kolom': nr, 'tekst': tekst[:60],
                            'wat': 'scheidingsteken zonder spatie ernaast'})
    return uit


def afwijkingen_zoeken(per_kolom, ritme) -> list:
    """Plekken waar het basisontwerp van zijn eigen ritme afwijkt."""
    uit = []
    for kolom_nr, alineas in enumerate(per_kolom, start=1):
        for a, b in zip(alineas, alineas[1:]):
            sleutel = f"{a['soort']}->{b['soort']}"
            afstand = round(b['regels'][0]['baseline'] - a['regels'][-1]['baseline'], 2)
            verwacht = ritme['overgang'].get(sleutel)
            if verwacht is not None and abs(afstand - verwacht) > 0.5:
                uit.append({
                    'kolom': kolom_nr,
                    'na': a['regels'][-1]['runs'][0]['tekst'].strip()[:40],
                    'voor': b['regels'][0]['runs'][0]['tekst'].strip()[:40],
                    'overgang': sleutel,
                    'gemeten': afstand,
                    'ritme': verwacht,
                })
    return uit


# ---------------------------------------------------------------- uitschrijven

# ----------------------------------------------------------------- opsommingen

BULLETS = ('•', '‣', '·')


def is_bullet(regel) -> bool:
    return regel['runs'][0]['tekst'].strip() in BULLETS


def opsomming_van(alinea):
    """Leest een opsomming met bullets uit een alinea, of geeft None.

    Zo staat "Tartelettes" in Grab & Go: per onderdeel een bullet met de naam, en
    daaronder een cursieve regel met de smaakomschrijving. Dat is geen uitzondering
    maar een opmaakvorm die overal kan opduiken, dus we leggen hem vast als
    structuur - onderdelen met een naam en een toelichting - in plaats van als
    losse regels tekst.
    """
    if alinea['soort'] != 'ingr' or not any(is_bullet(r) for r in alinea['regels']):
        return None

    bullet_regel = next(r for r in alinea['regels'] if is_bullet(r))
    naam_stijl = bullet_regel['runs'][-1]
    toelichting_stijl = next(
        (r['runs'][0] for r in alinea['regels']
         if not is_bullet(r) and (r['runs'][0]['font'], r['runs'][0]['grootte'])
         != (naam_stijl['font'], naam_stijl['grootte'])),
        None)

    onderdelen = []
    for regel in alinea['regels']:
        eerste = regel['runs'][0]
        if is_bullet(regel):
            tekst = ''.join(r['tekst'] for r in regel['runs'][1:]).strip()
            onderdelen.append({'naam': tekst, 'toelichting': []})
        elif not onderdelen:
            continue
        elif toelichting_stijl and (eerste['font'], eerste['grootte']) == \
                (toelichting_stijl['font'], toelichting_stijl['grootte']):
            regeltekst = ''.join(r['tekst'] for r in regel['runs']).strip()
            onderdelen[-1]['toelichting'].append(regeltekst)
        else:
            # doorloop van een lange onderdeelnaam
            onderdelen[-1]['naam'] += ' ' + ''.join(r['tekst'] for r in regel['runs']).strip()

    for onderdeel in onderdelen:
        samen = ' '.join(onderdeel['toelichting'])
        onderdeel['toelichting'] = [p.strip() for p in samen.split('|') if p.strip()]

    # Baseline-afstanden: naar een toelichting, en naar de volgende bullet.
    naar_toelichting = naar_bullet = None
    for vorige, deze in zip(alinea['regels'], alinea['regels'][1:]):
        afstand = round(deze['baseline'] - vorige['baseline'], 2)
        if is_bullet(deze):
            naar_bullet = afstand
        elif naar_toelichting is None:
            naar_toelichting = afstand

    return {
        'onderdelen': onderdelen,
        'stijl': {
            'bullet': bullet_regel['runs'][0]['tekst'].strip(),
            'bulletX': rond(bullet_regel['runs'][0]['x']),
            'inspring': rond(naam_stijl['x'] - bullet_regel['runs'][0]['x']),
            'naam': {'font': naam_stijl['font'], 'grootte': naam_stijl['grootte'],
                     'kleur': naam_stijl['kleur']},
            'toelichting': ({'font': toelichting_stijl['font'],
                             'grootte': toelichting_stijl['grootte'],
                             'kleur': toelichting_stijl['kleur']} if toelichting_stijl else None),
            'naarToelichting': naar_toelichting,
            'naarBullet': naar_bullet,
        },
    }


def opsomming_ratios(doc):
    """De maten van een opsomming, uitgedrukt als verhouding tot het ingredientencorps.

    De basisontwerpen bestaan in twee typografische schalen die precies een factor
    1,1 schelen (72/56/38 tegenover 79,2/61,6/41,8). Door de opsomming als
    verhouding vast te leggen kan hij in elk pakket gezet worden, ook in pakketten
    waar het .ai-bestand er geen heeft - en dat moet kunnen, want een gerecht met
    bullets kan naar een ander pakket verhuizen.
    """
    for pagina_nr, _ in PAKKETTEN:
        page = doc[pagina_nr - 1]
        alles = spans_van(page)
        inhoud = [s for s in alles if s['soort'] != 'titel' and not is_sjabloontekst(s)]
        marges = kolom_x(inhoud)
        for i, links in enumerate(marges):
            grens = marges[i + 1] - 40 if i + 1 < len(marges) else 1e9
            eigen = [s for s in inhoud if links - 40 <= s['x'] < grens]
            for alinea in alineas_bouwen(regels_bouwen(eigen)):
                gevonden = opsomming_van(alinea)
                if not gevonden:
                    continue
                stijl = gevonden['stijl']
                basis = stijl['naam']['grootte']
                return {
                    'bron': f'pagina {pagina_nr}',
                    'bullet': stijl['bullet'],
                    'naamFont': stijl['naam']['font'],
                    'naamKleur': stijl['naam']['kleur'],
                    'toelichtingFont': stijl['toelichting']['font'],
                    'toelichtingKleur': stijl['toelichting']['kleur'],
                    'inspring': stijl['inspring'] / basis,
                    'toelichtingGrootte': stijl['toelichting']['grootte'] / basis,
                    'naarToelichting': stijl['naarToelichting'] / basis,
                    'naarBullet': stijl['naarBullet'] / basis,
                }
    return None


def opsomming_stijl(ratios, ingr_grootte: float) -> dict:
    """De opsomming-maten voor een pakket, geschaald op zijn eigen ingredientencorps."""
    return {
        'bullet': ratios['bullet'],
        'inspring': rond(ratios['inspring'] * ingr_grootte),
        'naam': {'font': ratios['naamFont'], 'grootte': rond(ingr_grootte),
                 'kleur': ratios['naamKleur']},
        'toelichting': {'font': ratios['toelichtingFont'],
                        'grootte': rond(ratios['toelichtingGrootte'] * ingr_grootte),
                        'kleur': ratios['toelichtingKleur']},
        'naarToelichting': rond(ratios['naarToelichting'] * ingr_grootte),
        'naarBullet': rond(ratios['naarBullet'] * ingr_grootte),
    }


def secties_van(alineas) -> list:
    """De alinea's van een kolom gegroepeerd tot secties met gerechten.

    Een kop begint een sectie, een gerechtnaam begint een gerecht en een
    ingredientenblok hoort bij het gerecht erboven. Deze indeling leggen we hier
    eenmalig vast, zodat de renderer hem niet opnieuw hoeft af te leiden.
    """
    secties = []
    sectie = None
    gerecht = None
    for i, alinea in enumerate(alineas):
        if alinea['soort'] == 'kop':
            sectie = {'kopAlinea': i, 'gerechten': []}
            secties.append(sectie)
            gerecht = None
        elif alinea['soort'] == 'naam':
            if sectie is None:
                sectie = {'kopAlinea': None, 'gerechten': []}
                secties.append(sectie)
            gerecht = {'naamAlinea': i, 'ingrAlinea': None}
            sectie['gerechten'].append(gerecht)
        elif alinea['soort'] in ('ingr', 'opsomming') and gerecht is not None:
            gerecht['ingrAlinea'] = i
    return secties


def alinea_naar_json(alinea, links):
    regels = []
    for regel in alinea['regels']:
        runs = [{
            'tekst': r['tekst'],
            'x': rond(r['x'] - links),
            'font': r['font'],
            'grootte': r['grootte'],
            'kleur': r['kleur'],
        } for r in regel['runs']]
        regels.append({'baseline': rond(regel['baseline']), 'runs': runs})
    # De platte tekst is wat de renderer opnieuw afbreekt als de inhoud wijzigt.
    tekst = ' '.join(''.join(r['tekst'] for r in regel['runs']).strip() for regel in alinea['regels'])
    uit = {'soort': alinea['soort'], 'tekst': re.sub(r'\s+', ' ', tekst).strip()}

    # Een opsomming met bullets leggen we vast als structuur, niet als losse
    # regels: dan kan hij opnieuw gezet worden als er een onderdeel bij komt of
    # als het gerecht naar een ander pakket verhuist.
    gevonden = opsomming_van(alinea)
    if gevonden:
        uit['soort'] = 'opsomming'
        uit['onderdelen'] = gevonden['onderdelen']

    uit['regels'] = regels
    return uit


def pakket_extraheren(doc, pagina_nr: int, naam: str, ratios=None) -> dict:
    page = doc[pagina_nr - 1]
    woordcorrecties = set()
    alles = spans_van(page, woordcorrecties)

    titel = next((s for s in alles if s['soort'] == 'titel'), None)
    voet = [s for s in alles if s['tekst'].strip() in VOET_REGELS]
    logo_span = next((s for s in alles if s['tekst'].strip() == LOGO_TEKST), None)
    inhoud = [s for s in alles if s['soort'] != 'titel' and not is_sjabloontekst(s)]

    groottes = {k: statistics.median([s['grootte'] for s in inhoud if s['soort'] == k] or [0])
                for k in ('kop', 'naam', 'ingr')}

    marges = kolom_x(inhoud)
    kolommen = []
    per_kolom = []
    regels_per_kolom = []
    for i, links in enumerate(marges):
        rechts_grens = marges[i + 1] - 40 if i + 1 < len(marges) else 1e9
        eigen = [s for s in inhoud if links - 40 <= s['x'] < rechts_grens]
        regels = regels_bouwen(eigen)
        regels_per_kolom.append((links, regels))
        per_kolom.append(alineas_bouwen(regels))

    # Woordbreedtes en spatiebreedtes komen uit de pagina zelf; die hebben we nodig
    # om te bepalen hoe breed de tekstkaders in Illustrator waren.
    index = woordindex(page)
    spaties = spatiebreedtes(page)

    for i, ((links, _), alineas) in enumerate(zip(regels_per_kolom, per_kolom)):
        grens = marges[i + 1] - 40 if i + 1 < len(marges) else 1e9
        kolommen.append({
            'x': rond(links),
            'kader': kaderbreedte(alineas, links, grens, index, spaties),
            'secties': secties_van(alineas),
            'alineas': [alinea_naar_json(a, links) for a in alineas],
        })

    ritme = ritme_meten(per_kolom)
    balk = rode_balk(page)

    # Correcties op de bron toepassen; wat er niet meer nodig is, melden we.
    bronTitel = titel['tekst'].strip() if titel else ''
    titelTekst = bronTitel
    correctie = CORRECTIES.get(naam, {}).get('titel')
    if correctie:
        staat_er, moet_zijn = correctie
        if bronTitel == staat_er:
            titelTekst = moet_zijn
        elif bronTitel == moet_zijn:
            print(f'  {naam}: de titel in het .ai is inmiddels "{moet_zijn}"; '
                  f'de correctie in CORRECTIES kan weg.')
        else:
            print(f'  {naam}: correctie verwacht titel "{staat_er}" maar het .ai zegt '
                  f'"{bronTitel}". Niets gewijzigd - kijk hier even naar.')

    icoon = goud_rect(page)

    stijl = {}
    for soort in ('kop', 'naam', 'ingr'):
        voorbeelden = [s for s in inhoud if s['soort'] == soort]
        if not voorbeelden:
            continue
        stijl[soort] = {
            'font': Counter(s['font'] for s in voorbeelden).most_common(1)[0][0],
            'grootte': round(groottes[soort], 2),
            'kleur': Counter(s['kleur'] for s in voorbeelden).most_common(1)[0][0],
        }

    return {
        'pakket': naam,
        'bron': {'bestand': BRON.name, 'pagina': pagina_nr},
        'canvas': {'breedte': 3840, 'hoogte': 2160},
        'achtergrond': f'{naam}.png',
        'titel': {
            'tekst': titelTekst,
            # Wat er in het .ai staat, als dat iets anders is dan wat we zetten.
            # controle.mjs vergelijkt daarmee, zodat de pixelvergelijking blijft
            # kloppen terwijl het scherm de gecorrigeerde titel toont.
            **({'bronTekst': bronTitel} if bronTitel != titelTekst else {}),
            'x': rond(titel['x']) if titel else 0,
            'baseline': rond(titel['baseline']) if titel else 0,
            'font': titel['font'] if titel else 'Pockota-Medium',
            'grootte': titel['grootte'] if titel else 199.53,
            'kleur': titel['kleur'] if titel else '#000000',
        },
        'logobalk': {
            'x': rond(balk.x0), 'y': rond(balk.y0),
            'breedte': rond(balk.width), 'hoogte': rond(balk.height),
            'vulkleur': '#ff0000',
            'plaatshouder': {
                'tekst': LOGO_TEKST,
                'font': logo_span['font'] if logo_span else 'AreaNormal-ExtraBold',
                'grootte': logo_span['grootte'] if logo_span else 57.0,
                'baseline': rond(logo_span['baseline']) if logo_span else 0,
                'x': rond(logo_span['x']) if logo_span else 0,
            },
        } if balk else None,
        'voetregel': {
            'icoon': {'x': rond(icoon.x0), 'y': rond(icoon.y0),
                      'breedte': rond(icoon.width), 'hoogte': rond(icoon.height),
                      'kleur': ACCENT} if icoon else None,
            'regels': [{'tekst': s['tekst'].strip(), 'x': rond(s['x']),
                        'baseline': rond(s['baseline']), 'font': s['font'],
                        'grootte': s['grootte'], 'kleur': s['kleur']}
                       for s in sorted(voet, key=lambda s: s['baseline'])],
        },
        # Wat we bewust anders zetten dan het .ai. controle.mjs draait dit terug
        # voor de vergelijking, anders meet je je eigen correctie als fout.
        'correcties': ({'woorden': sorted([list(w) for w in woordcorrecties])}
                       if woordcorrecties else None),
        'stijl': stijl,
        'opsommingStijl': (opsomming_stijl(ratios, stijl['ingr']['grootte'])
                           if ratios and 'ingr' in stijl else None),
        'ritme': ritme,
        'spatie': {str(g): b for g, b in sorted(spaties.items())},
        'kolommen': kolommen,
        'afwijkingen': afwijkingen_zoeken(per_kolom, ritme),
        'zetfouten': zetfouten_zoeken(kolommen),
    }


def kaders_delen(alles: dict) -> None:
    """Pagina's met dezelfde kolomindeling delen hun tekstkaders.

    Pagina 7 en 8 zijn dezelfde layout: kolommen op 261, 1352 en 2278. Toch leidde
    de extractie er twee verschillende kaderbreedtes uit af, omdat elke pagina
    alleen zijn eigen inhoud te zien kreeg - en in de ene kolom staat nu eenmaal
    een langere regel dan in de andere. Het kader dat de ontwerper trok is
    hetzelfde; door de grenzen samen te nemen komen we er dichter bij.

    De ondergrens wordt de langste regel van alle pagina's samen, de bovengrens de
    scherpste afbreking. Vallen die over elkaar heen, dan zijn het toch niet
    dezelfde kaders en houdt elke pagina zijn eigen waarde.
    """
    groepen = {}
    for naam, data in alles.items():
        sleutel = (tuple(rond(k['x'], 0) for k in data['kolommen']),
                   data['stijl'].get('ingr', {}).get('grootte'))
        groepen.setdefault(sleutel, []).append(naam)

    for sleutel, namen in groepen.items():
        if len(namen) < 2:
            continue
        for i in range(len(sleutel[0])):
            kaders = [alles[n]['kolommen'][i]['kader'] for n in namen]
            onder = max(k['minimaal'] for k in kaders)
            boven = min(k['maximaal'] for k in kaders)
            if boven <= onder:
                print(f'  kolom {i + 1} van {", ".join(namen)}: de kadergrenzen sluiten '
                      f'elkaar uit ({onder} vs {boven}); elke pagina houdt zijn eigen kader.')
                continue
            marge = max(6.0, onder * 0.012)
            gekozen = onder + marge if onder + marge < boven else (onder + boven) / 2
            for k in kaders:
                k['minimaal'] = rond(onder)
                k['maximaal'] = rond(boven)
                k['breedte'] = rond(gekozen)
                k['gedeeldMet'] = [n for n in namen]


def regelval_van(alinea) -> list:
    """De regels van een alinea, met hoeveel elke volgende regel lager staat."""
    nul = alinea['regels'][0]['baseline']
    return [{'tekst': ''.join(r['tekst'] for r in regel['runs']).rstrip(),
             'offset': rond(regel['baseline'] - nul)}
            for regel in alinea['regels']]


def gerechtenbibliotheek(alles: dict) -> dict:
    """Legt vast hoe elk gerecht uit de basisontwerpen op het scherm hoort te staan.

    NBC werkt met een vast repertoire: dezelfde gerechten komen in verschillende
    pakketten terug. Staat een gerecht in een ontwerp, dan is dat de manier waarop
    het gezet hoort te worden - inclusief waar de naam ophoudt en waar de regels
    afbreken. Anders zou onze eigen afbreking dat bepalen, en die kijkt alleen naar
    kaderbreedte.

    Er zitten twee lagen in:

    gerechten  het hele gerecht, zoals iemand het intypt: "naam | ingredient |
               ingredient". Dit is de laag die ertoe doet, want hij weet ook waar
               de naam ophoudt. Schrijft iemand dezelfde schotel met de streep op
               een andere plek, dan wordt hij nog steeds gevonden en alsnog gezet
               zoals de ontwerper hem zette.
    alineas    losse namen en omschrijvingen. Vangnet voor het geval een gerecht
               deels terugkomt - "Burrata" staat in twee pakketten met heel andere
               ingredienten, en die naam hoort in allebei hetzelfde te breken.

    Ook teksten die op een regel passen gaan mee: dat ze niet afbreken is net zo
    goed een keuze van de ontwerper, en zonder die vastlegging zou een net iets te
    smal kader ze alsnog in tweeen hakken.
    """
    gerechten = {}
    alineas = {}

    for pakket, data in alles.items():
        for kolom in data['kolommen']:
            for sectie in kolom['secties']:
                for gerecht in sectie['gerechten']:
                    naam_alinea = kolom['alineas'][gerecht['naamAlinea']]
                    omschrijving = (kolom['alineas'][gerecht['ingrAlinea']]
                                    if gerecht['ingrAlinea'] is not None else None)
                    if omschrijving is not None and omschrijving['soort'] == 'opsomming':
                        # Een opsomming met bullets is een eigen structuur; die staat
                        # als onderdelen in het pakket zelf en hoort hier niet thuis.
                        continue

                    naam_grootte = naam_alinea['regels'][0]['runs'][0]['grootte']
                    volledig = naam_alinea['tekst']
                    if omschrijving is not None:
                        volledig = f"{volledig} | {omschrijving['tekst']}"

                    sleutel = f'{maat(naam_grootte)}|{gerechtsleutel(volledig)}'
                    if sleutel in gerechten:
                        eerder = gerechten[sleutel]
                        if (eerder['naam'] != naam_alinea['tekst']
                                or eerder['naamRegels'] != regelval_van(naam_alinea)):
                            print(f'  "{volledig[:60]}" staat in {eerder["bron"]} en in '
                                  f'{pakket} anders gezet; {eerder["bron"]} telt.')
                    else:
                        gerechten[sleutel] = {
                            'naam': naam_alinea['tekst'],
                            'ingredienten': ([p.strip() for p in omschrijving['tekst'].split('|') if p.strip()]
                                             if omschrijving is not None else []),
                            'bron': pakket,
                            'naamGrootte': naam_grootte,
                            'naamRegels': regelval_van(naam_alinea),
                            'ingrGrootte': (omschrijving['regels'][0]['runs'][0]['grootte']
                                            if omschrijving is not None else None),
                            'ingrRegels': (regelval_van(omschrijving)
                                           if omschrijving is not None else None),
                        }

            for alinea in kolom['alineas']:
                if alinea['soort'] not in ('naam', 'ingr'):
                    continue
                grootte = alinea['regels'][0]['runs'][0]['grootte']
                sleutel = f"{alinea['soort']}|{maat(grootte)}|{tekstsleutel(alinea['tekst'])}"
                if sleutel in alineas:
                    continue
                alineas[sleutel] = {
                    'soort': alinea['soort'],
                    'grootte': grootte,
                    'tekst': alinea['tekst'],
                    'bron': pakket,
                    'regels': regelval_van(alinea),
                }

    return {'gerechten': dict(sorted(gerechten.items())),
            'alineas': dict(sorted(alineas.items()))}


# Tekens die wel anders gezet worden maar hetzelfde betekenen. Wie een rechte
# apostrof typt hoort hetzelfde gerecht te vinden als de ontwerper met een
# typografische apostrof heeft gezet.
VARIANTEN = str.maketrans({
    '\u2019': "'", '\u2018': "'", '\u201c': '"', '\u201d': '"',
    '\u00b4': "'", '\u0060': "'",
})


def maat(grootte) -> str:
    """Een corpsgrootte als sleutel, zoals JavaScript hem ook zou schrijven.

    Python maakt van 56.0 de tekst "56.0" en JavaScript "56". Zonder deze stap
    matcht de helft van de bibliotheek niet - en dan valt de engine stilletjes
    terug op zijn eigen afbreking.
    """
    return f'{float(grootte):g}'


def tekstsleutel(tekst: str) -> str:
    """Tekst vergelijkbaar maken om hem in de bibliotheek terug te vinden.

    Spaties rond het scheidingsteken, de soort apostrof en hoofdletters doen niet
    mee: dat is zetwerk, geen andere inhoud. Wat er getekend wordt is wel altijd de
    tekst zoals hij in het ontwerp staat.
    """
    t = str(tekst).translate(VARIANTEN).lower()
    t = re.sub(r'\s*\|\s*', ' | ', t)
    t = re.sub(r'\s+', ' ', t)
    return re.sub(r'^\s*\|\s*|\s*\|\s*$', '', t).strip()


def gerechtsleutel(tekst: str) -> str:
    """De sleutel van een heel gerecht: naam en ingredienten samen.

    Waar de streep staat telt hier niet mee. "Dessertbuffet met zoete lekkernijen |
    L'OR Coffee Popping Pearls" en "Dessertbuffet | met zoete lekkernijen | L'OR
    Coffee Popping Pearls" zijn hetzelfde gerecht; waar de naam ophoudt staat in de
    bibliotheek en niet in wat iemand intypt.
    """
    return re.sub(r'\s+', ' ', tekstsleutel(tekst).replace('|', ' ')).strip()


def main():
    BASIS.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(BRON)

    # Het bestek-icoon is op elke pagina hetzelfde vectorwerk, alleen anders geschaald.
    icoon = icoon_pad(doc[6])
    kader = goud_rect(doc[6])
    (BASIS / 'bestek-icoon.svg').write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {kader.width:.2f} {kader.height:.2f}">'
        f'{icoon}</svg>\n', encoding='utf-8')

    referentie = BASIS / 'referentie'
    referentie.mkdir(exist_ok=True)

    ratios = opsomming_ratios(doc)
    if not ratios:
        raise SystemExit('Geen opsomming gevonden in het .ai-bestand; de maten daarvan '
                         'zijn nodig om opsommingen in elk pakket te kunnen zetten.')
    print(f'Opsomming-maten afgeleid uit {ratios["bron"]}.')

    # Eerst alles uitlezen, dan pas wegschrijven: de tekstkaders en de
    # gerechtenbibliotheek hebben de pagina's naast elkaar nodig.
    alles = {naam: pakket_extraheren(doc, pagina_nr, naam, ratios)
             for pagina_nr, naam in PAKKETTEN}
    kaders_delen(alles)
    # De voorbeeldpagina's delen hun tekstkaders niet: dat zijn geen pakketten, en
    # hun kolommen staan net ergens anders. Hun gerechten tellen wel mee.
    voorbeelden = {naam: pakket_extraheren(doc, pagina_nr, naam, ratios)
                   for pagina_nr, naam in VOORBEELDEN}
    bibliotheek = gerechtenbibliotheek({**alles, **voorbeelden})
    (BASIS / 'gerechten.json').write_text(
        json.dumps(bibliotheek, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"Gerechtenbibliotheek: {len(bibliotheek['gerechten'])} gerechten, "
          f"{len(bibliotheek['alineas'])} losse alinea's vastgelegd.")

    overzicht = []
    for pagina_nr, naam in PAKKETTEN:
        data = alles[naam]
        pix = maak_achtergrond(pagina_nr)
        pix.save(BASIS / f'{naam}.png')
        # De volledige pagina uit het .ai: hiertegen vergelijkt controle.mjs de render.
        doc[pagina_nr - 1].get_pixmap(dpi=72, alpha=False).save(referentie / f'{naam}.png')
        (BASIS / f'{naam}.json').write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        gerechten = sum(1 for k in data['kolommen'] for a in k['alineas'] if a['soort'] == 'naam')
        secties = sum(1 for k in data['kolommen'] for a in k['alineas'] if a['soort'] == 'kop')
        overzicht.append((naam, pagina_nr, len(data['kolommen']), secties, gerechten,
                          len(data['afwijkingen']), len(data['zetfouten'])))
        print(f'{naam:24s} p{pagina_nr}  {len(data["kolommen"])} kolommen  '
              f'{secties} secties  {gerechten:2d} gerechten  '
              f'{len(data["afwijkingen"]):2d}x ritme-afwijking  '
              f'{len(data["zetfouten"])}x zetfout')

    print('\nPagina 9 is een exacte kopie van pagina 8 en is overgeslagen.')
    for pagina_nr, naam in VOORBEELDEN:
        print(f'Pagina {pagina_nr} is geen pakket; alleen zijn gerechten gaan de '
              f'bibliotheek in (als "{naam}").')
    return overzicht


if __name__ == '__main__':
    main()
