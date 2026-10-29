"""Bouwt de gids 'Designs aanvragen bij Marketing' en zet hem om naar PDF.

De opmaak (stijlen, kop- en voettekst met het NBC-logo) komt uit het Word-bestand van de gids
zelf, die oorspronkelijk van de drankgids is overgenomen. De tekst staat hieronder; de beelden
komen uit bron/kader/ (zie screenshots.cjs en kader.py).

    python3 docs/gids-projecten/bron/bouw.py
"""
import os, re, shutil, subprocess, sys, tempfile, zipfile
from xml.sax.saxutils import escape
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
NAAM = 'Designs aanvragen - Handleiding voor projecten'
UIT = os.path.join(HIER, '..', NAAM + '.docx')
SHOTS = os.path.join(HIER, 'kader')
SJABLOON = tempfile.mkdtemp()
with zipfile.ZipFile(UIT) as z:
    z.extractall(SJABLOON)
BOLD = '<w:rFonts w:ascii="Area Normal Extrabold" w:hAnsi="Area Normal Extrabold"/>'
ORANJE = 'E8590C'

def runs(t):
    """Tekst met **vet**."""
    out = []
    for i, deel in enumerate(re.split(r'\*\*', t)):
        if not deel: continue
        rpr = f'<w:rPr>{BOLD}</w:rPr>' if i % 2 else ''
        out.append(f'<w:r>{rpr}<w:t xml:space="preserve">{escape(deel)}</w:t></w:r>')
    return ''.join(out)

koppelingen = []  # (rId, url)
def link(tekst, url):
    rid = f'rIdL{len(koppelingen) + 1}'
    koppelingen.append((rid, url))
    return (f'<w:hyperlink r:id="{rid}"><w:r><w:rPr><w:color w:val="229D96"/><w:u w:val="single"/></w:rPr>'
            f'<w:t xml:space="preserve">{escape(tekst)}</w:t></w:r></w:hyperlink>')

def p_met(delen, ppr=''):
    """Een alinea uit stukken: gewone tekst (met **vet**) en kant-en-klare links."""
    return f'<w:p><w:pPr>{ppr}</w:pPr>' + ''.join(d if d.startswith('<w:hyperlink') else runs(d) for d in delen) + '</w:p>'

def p(t='', ppr=''):
    return f'<w:p><w:pPr>{ppr}</w:pPr>{runs(t)}</w:p>'

def kop1(t):
    """Een hoofdstuk loopt door op dezelfde pagina; de kop blijft bij wat erop volgt."""
    return f'<w:p><w:pPr><w:pStyle w:val="Kop1"/><w:keepNext/><w:spacing w:before="280"/></w:pPr>{runs(t)}</w:p>'

def kop2(t):
    return f'<w:p><w:pPr><w:pStyle w:val="Kop2"/></w:pPr>{runs(t)}</w:p>'

def intro(t):
    return p(t, '<w:keepNext/>')

TAB = '<w:tabs><w:tab w:val="left" w:pos="425"/></w:tabs><w:spacing w:after="120"/><w:ind w:left="425" w:hanging="425"/>'
def nummer(n, t):
    return (f'<w:p><w:pPr>{TAB}</w:pPr><w:r><w:rPr>{BOLD}<w:color w:val="{ORANJE}"/><w:sz w:val="22"/></w:rPr>'
            f'<w:t>{n}</w:t></w:r><w:r><w:tab/></w:r>{runs(t)}</w:p>')
def bol(t):
    return f'<w:p><w:pPr>{TAB}</w:pPr><w:r><w:rPr><w:color w:val="{ORANJE}"/></w:rPr><w:t>•</w:t></w:r><w:r><w:tab/></w:r>{runs(t)}</w:p>'

KADER = '<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="F6A304"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="FDF3E4"/><w:ind w:left="198"/>'
def kader(kop, tekst):
    """Een geel vlak met een oranje streep links, met evenveel ruimte boven als onder de tekst."""
    # Een lege regel ervoor, anders groeit het vlak vast aan een tabel erboven
    return (p('', '<w:keepNext/><w:spacing w:after="0" w:line="160" w:lineRule="exact"/>') + f'<w:tbl><w:tblPr><w:tblW w:w="{BREEDTE}" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="single" w:sz="24" w:space="0" w:color="F6A304"/>'
            '<w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>'
            f'<w:tblGrid><w:gridCol w:w="{BREEDTE}"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="{BREEDTE}" w:type="dxa"/>'
            '<w:shd w:val="clear" w:color="auto" w:fill="FDF3E4"/><w:tcMar><w:top w:w="170" w:type="dxa"/><w:left w:w="240" w:type="dxa"/><w:bottom w:w="170" w:type="dxa"/><w:right w:w="240" w:type="dxa"/></w:tcMar>'
            '<w:vAlign w:val="center"/></w:tcPr>'
            f'<w:p><w:pPr><w:keepNext/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr>{BOLD}</w:rPr><w:t xml:space="preserve">{escape(kop)}</w:t></w:r></w:p>'
            f'<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>{runs(tekst)}</w:p>'
            '</w:tc></w:tr></w:tbl>' + p('', '<w:spacing w:after="0" w:line="160" w:lineRule="exact"/>'))

def lijstpunt(t, bij_elkaar=True):
    vast = '<w:keepNext/>' if bij_elkaar else ''
    return f'<w:p><w:pPr><w:pStyle w:val="Lijstalinea"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>{vast}<w:spacing w:after="60"/></w:pPr>{runs(t)}</w:p>'

GEEN_RAND = ('<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>'
             '<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/>')

beelden = []  # (rId, bestandsnaam)
def beeld(naam, breedte_twips):
    pad = os.path.join(SHOTS, naam + '.jpg')
    w, h = Image.open(pad).size
    cx = breedte_twips * 635  # twips -> EMU
    cy = cx * h // w
    rid = f'rIdG{len(beelden) + 1}'
    beelden.append((rid, naam + '.jpg'))
    n = len(beelden) + 100
    return (f'<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/>'
            f'<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="{n}" name="Afbeelding {n}"/><wp:cNvGraphicFramePr>'
            '<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
            '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="{naam}.jpg"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')

BEELD_W, BREEDTE = 3700, 9015
def los(*regels):
    """Uitleg zonder screenshot: de regels onder elkaar, en samen op één pagina."""
    return ''.join(r.replace('<w:pPr>', '<w:pPr><w:keepNext/>', 1) for r in regels[:-1]) + regels[-1]
def stap(naam, *regels, beeld_w=BEELD_W):
    """Screenshot links, uitleg rechts - zoals de drankgids, maar met een breder beeld voor het computerscherm."""
    tekst = ''.join(regels)
    BEELD_W, TEKST_W = beeld_w, BREEDTE - beeld_w
    return (f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>{GEEN_RAND}</w:tblPr><w:tblGrid><w:gridCol w:w="{BEELD_W}"/><w:gridCol w:w="{TEKST_W}"/></w:tblGrid>'
            f'<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="{BEELD_W}" w:type="dxa"/><w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>'
            f'<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>{beeld(naam, BEELD_W)}</w:p></w:tc>'
            f'<w:tc><w:tcPr><w:tcW w:w="{TEKST_W}" w:type="dxa"/><w:tcMar><w:top w:w="120" w:type="dxa"/><w:left w:w="240" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>'
            f'{tekst}</w:tc></w:tr></w:tbl>' + p('', '<w:spacing w:after="0" w:line="120" w:lineRule="exact"/>'))

def cel(w, inhoud, vul=None, mar='<w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tcMar>'):
    shd = f'<w:shd w:val="clear" w:color="auto" w:fill="{vul}"/>' if vul else ''
    return f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{shd}{mar}</w:tcPr>{inhoud}</w:tc>'

def tabel(kop, rijen, ws=(3969, 5046)):
    def r(cellen, koprij=False):
        out = ''
        for w, t in zip(ws, cellen):
            if koprij:
                inh = f'<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr>{BOLD}<w:color w:val="FFFFFF"/></w:rPr><w:t>{escape(t)}</w:t></w:r></w:p>'
                out += cel(w, inh, '229D96')
            else:
                out += cel(w, p(t, '<w:spacing w:after="40"/>'))
        return f'<w:tr><w:trPr><w:cantSplit/></w:trPr>{out}</w:tr>'
    grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in ws)
    rows = (r(kop, True) if kop else '') + ''.join(r([f'**{a}**', b]) for a, b in rijen)
    return f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>{GEEN_RAND}</w:tblPr><w:tblGrid>{grid}</w:tblGrid>{rows}</w:tbl>'

def inhoud(rijen):
    mar = '<w:tcMar><w:top w:w="30" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>'
    out = ''
    for n, a, b in rijen:
        out += ('<w:tr>' + cel(510, f'<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Pockota Med" w:hAnsi="Pockota Med"/><w:color w:val="229D96"/><w:sz w:val="20"/></w:rPr><w:t>{n}</w:t></w:r></w:p>', mar=mar)
                + cel(3061, p(f'**{a}**', '<w:spacing w:after="20"/>'), mar=mar) + cel(5443, p(b, '<w:spacing w:after="20"/>'), mar=mar) + '</w:tr>')
    return f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>{GEEN_RAND}</w:tblPr><w:tblGrid><w:gridCol w:w="510"/><w:gridCol w:w="3061"/><w:gridCol w:w="5443"/></w:tblGrid>{out}</w:tbl>'

# ── Inhoud ───────────────────────────────────────────────────────────────────
# De tekst van Anouk (manager Marketing, oktober 2026), letterlijk, met haar aanhalingstekens.
# Alleen verbeterd: taalfouten en wat niet klopt met het formulier (zie het commitbericht).
B = []
B.append(f'<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr>{BOLD}<w:color w:val="165E5A"/></w:rPr><w:t xml:space="preserve">HANDLEIDING  </w:t></w:r><w:r><w:rPr>{BOLD}<w:color w:val="165E5A"/></w:rPr><w:t>OKTOBER 2026</w:t></w:r></w:p>')
B.append('<w:p><w:pPr><w:pStyle w:val="Kop1"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:sz w:val="54"/></w:rPr><w:t>Design aanvraag</w:t></w:r></w:p>')
# ── De basis: zonder screenshots, tekst precies zoals Marketing hem aanleverde ─
ZWART_BOL = lambda t: lijstpunt(t, bij_elkaar=False)
B.append(p_met(['Via het formulier ', link('Designaanvraag', 'https://marketing-nbc.github.io/designaanvraag'), ' vraag je eenvoudig designs aan voor events en interne doeleinden, zoals visitekaartjes of posters. Volg onderstaande afspraken om je aanvraag zo soepel mogelijk te laten verlopen.']))
B.append(kop2('1. Dien je aanvraag op tijd in'))
B.append(ZWART_BOL('Vraag je design minimaal 10 werkdagen vóór het event aan.'))
B.append(ZWART_BOL('Is de deadline korter? Dan geldt de aanvraag als spoed. Stem deadlines binnen 5 werkdagen altijd af met marketing.'))
B.append(ZWART_BOL('Houd er rekening mee dat drukwerk bij korte deadlines mogelijk niet op tijd klaar is.'))
B.append(kop2('2. Dien één aanvraag per event in'))
B.append(ZWART_BOL('Vink alle designs aan die je voor het event nodig hebt.'))
B.append(ZWART_BOL('Voeg waar mogelijk een briefing, logo’s, voorbeelden en de website van het event of bedrijf toe.'))
B.append(ZWART_BOL('Geef duidelijk aan welke teksten, formaten en overige wensen van toepassing zijn.'))
B.append(ZWART_BOL('Kies standaarddesigns, tenzij de opdrachtgever een eigen ontwerp wenst en hiervoor betaalt.'))
B.append(kop2('3. Verstuur je aanvraag via het formulier'))
B.append(ZWART_BOL('Vul alle vragen in en controleer je antwoorden in het overzicht.'))
B.append(ZWART_BOL('Klik op Verstuur aanvraag om je aanvraag definitief in te dienen.'))
B.append(ZWART_BOL('Je antwoorden worden automatisch bewaard, zodat je later verder kunt gaan als dat nodig is.'))
B.append(kop2('4. Geef feedback en wijzigingen altijd door via het formulier'))
B.append(ZWART_BOL('Gebruik de knop Feedback geven in de e-mail die je ontvangt zodra je design klaar is.'))
B.append(ZWART_BOL('Iets vergeten, een extra design nodig of een datum gewijzigd? Kies dan Iets aanvullen of wijzigen.'))
B.append(ZWART_BOL('Dien hiervoor geen nieuwe aanvraag in en geef wijzigingen niet door via losse e-mails, Teams of WhatsApp.'))
B.append(kop2('5. Je design is klaar'))
B.append(p_met(['Je ontvangt een e-mail van designaanvraag (', link('designaanvraag@nbcevents.nl', 'mailto:designaanvraag@nbcevents.nl'), ') met de bestanden of informatie over waar je deze kunt vinden. Wil je nog iets aanpassen? Gebruik dan de knop Feedback geven in deze e-mail.']))
B.append(kop2('Hulp nodig of twijfel je?'))
B.append(p_met(['Mail marketing via ', link('marketing@nbcevents.nl', 'mailto:marketing@nbcevents.nl'), '. Voor Green Village kun je mailen naar ', link('marketing@green-village.nl', 'mailto:marketing@green-village.nl'), '.']))
B.append(p('Hieronder vind je de volledige handleiding met screenshots en uitleg per stap, van het indienen van een aanvraag tot het aanpassen van een bestaand design.', '<w:spacing w:before="120"/>'))

# ── De handleiding met screenshots begint op een nieuwe pagina ──────────────
B.append('<w:p><w:pPr><w:pStyle w:val="Kop2"/><w:pageBreakBefore/></w:pPr><w:r><w:t>In deze handleiding</w:t></w:r></w:p>')
B.append(inhoud([
    (1, 'Een aanvraag voor een event', ''),
    (2, 'Een interne aanvraag', ''),
    (3, 'Een menukaart of menuscherm', ''),
    (4, 'Je design is klaar', ''),
    (5, 'Aanvullen of wijzigen', ''),
    (6, 'Spoed en vragen', ''),
]))
B.append(p('De screenshots in deze handleiding komen uit het formulier en tonen een fictief event. Een oranje kader laat zien waar je moet klikken.', '<w:spacing w:before="200"/>'))

# 1
B.append(kop1('1.  Een aanvraag voor een event'))
B.append(intro('Klik op start en kies de locatie. Selecteer je naam in de lijst. Staat je naam er niet tussen, typ hem dan zelf. Kies voor een evenement en vul de naam van het event in zoals de opdrachtgever die gebruikt.'))
B.append(stap('g03-eventdatum',
    bol('Blader naar de juiste maand en klik de datum van het event aan. Duurt het event meerdere dagen, kies dan de eerste dag.'),
    bol('Kies vervolgens de deadline: de datum waarop het design klaar moet zijn. Deze datum mag niet na de eventdatum liggen.')))
B.append(stap('g08-modus',
    bol('Standaarddesigns zijn vaste templates die worden ingevuld met de gegevens van het event. Kies deze optie in de meeste gevallen.'),
    bol('Kies alleen voor ‘Volledig custom’ als de opdrachtgever een eigen ontwerp wenst en hiervoor betaalt.')))
B.append(stap('g06-bestanden',
    bol('Sleep een logo, voorbeelden of briefing naar het daarvoor bestemde vak, of klik erop om bestanden te kiezen.'),
    bol('Staat er een vinkje bij een bestand, dan wordt het meegestuurd.'),
    bol('Je kunt maximaal 5 bestanden van elk 25 MB toevoegen, zoals afbeeldingen, pdf-, Word- en PowerPoint-bestanden. Zijn de bestanden groter of gaat het om bronbestanden (AI, PSD of INDD)? Upload deze dan op de G-schijf en voeg de link naar de bestanden toe aan het formulier.')))
B.append(los(
    bol('Vul waar mogelijk de website van het bedrijf of event in. Zo kan marketing de juiste branding, zoals logo’s, kleuren en lettertypen, achterhalen. Is er geen website beschikbaar? Dan kun je dit veld leeg laten.'),
    bol('Vink alles aan wat je voor het event nodig hebt. Staat jouw keuze er niet bij? Kies dan ‘Anders, namelijk…’ en beschrijf wat je nodig hebt. Deze optie is er alleen bij ‘Volledig custom’.')))
B.append(stap('g09-wensen',
    bol('Vermeld alle informatie die marketing nodig heeft, zoals teksten, sfeer en gewenste formaten. Gebruik Enter om een nieuwe regel te beginnen.'),
    bol('Klik daarna op ‘Naar overzicht’.'),
    bol('Wil je dat een collega een e-mail ontvangt zodra het design klaar is? Vul dan hier de naam en het e-mailadres van deze collega in.')))
B.append(stap('g10-overzicht',
    bol('Wil je een antwoord aanpassen? Klik op ‘Wijzig’. Je keert daarna terug naar het overzicht.'),
    bol('Klik op ‘Verstuur aanvraag’ om je aanvraag definitief in te dienen.')))
B.append(stap('g11-gelukt',
    bol('Je aanvraag is nu ingediend bij marketing.'),
    bol('De huisstijl wordt op de achtergrond opgehaald; je hoeft hier niet op te wachten en kunt het venster sluiten.'),
    bol('Is het erg krap? Dan herinnert het formulier je eraan om contact op te nemen met marketing.'),
    bol('Iets vergeten of wil je iets aanpassen? Dien geen tweede aanvraag in, maar kies ‘Iets aanvullen of wijzigen’.')))
B.append(los(
    bol('Valt de eventdatum of deadline binnen 3 werkdagen? Dan verschijnt er een rode melding. Vul het formulier verder in. Het marketingteam beoordeelt vervolgens wat er binnen de korte deadline haalbaar is.'),
    bol('Valt het event binnen twee weken? Dan verschijnt er een oranje melding. Drukwerk, zoals geprinte menukaarten, vlaggen, banners en roll-ups, is waarschijnlijk niet meer op tijd klaar.'),
    bol('Valt de deadline binnen 5 werkdagen? Dan verschijnt er ook een melding. Je kunt de aanvraag verder invullen, maar stem de planning eerst even af met marketing.')))

# 2
B.append(kop1('2.  Een interne aanvraag'))
B.append(intro('Gebruik deze optie voor aanvragen die niet aan een event gekoppeld zijn, zoals visitekaartjes of een poster voor de kantine. Selecteer de locatie en vul je naam in, zoals eerder beschreven. Kies vervolgens ‘Intern’. Je hoeft dan nog maar twee vragen te beantwoorden.'))
B.append(los(bol('Beschrijf je aanvraag volledig in één keer. Vermeld wat je nodig hebt, het gewenste formaat, de teksten en voor wie het bedoeld is.')))
B.append(stap('g22-intern-deadline',
    bol('Geef aan wanneer je het nodig hebt.'),
    bol('Is er geen haast bij? Kies dan ‘Geen deadline’. Marketing plant de aanvraag dan in op een geschikt moment.'),
    bol('Ontstaat er later alsnog een deadline? Geef dit dan door via ‘Iets aanvullen of wijzigen’.')))

# 3
B.append(kop1('3.  Een menukaart of menuscherm'))
B.append(intro('Selecteer bij ‘Wat wil je aanvragen?’ de optie ‘Menukaart print’, ‘Menu scherm’ of beide. Er verschijnt vervolgens een extra vraag: om welk menu gaat het?'))
B.append(los(bol('Kies het gewenste pakket. Onder de pakketnaam zie je welke gangen zijn inbegrepen.')))
B.append(intro('Pas het menu aan waar nodig:'))
B.append(stap('g32-menu-inhoud',
    bol('Wissel: vervang een gerecht door een ander gerecht.'),
    bol('×: verwijder een gerecht.'),
    bol('+ Gerecht toevoegen: voeg een extra gerecht toe.'),
    bol('Pakket wijzigen: kies een ander pakket.'),
    bol('Selecteer de gerechten uit de lijst. Voer je zelf een gerecht in? Dan verschijnt er een melding en beoordeelt marketing de invoer.'),
    bol('Menu later aanpassen? Kies dan ‘Menu aanpassen’ via ‘Iets aanvullen of wijzigen’.')))

# 4
B.append(kop1('4.  Je design is klaar'))
B.append(intro('Zodra je design klaar is, ontvang je een e-mail van designaanvraag (designaanvraag@nbcevents.nl).'))
B.append(stap('g50-mail',
    bol('Herken de juiste e-mail aan het onderwerp. Dit begint met ‘Klaar’, gevolgd door de naam van het event en wat je hebt aangevraagd. Bij een nieuwe versie staat er bijvoorbeeld ‘Versie 2 klaar’.'),
    bol('Download je bestanden uit de e-mail. De bestanden zijn als bijlage toegevoegd. Grote drukbestanden staan op de schijf. Marketing vermeldt in de e-mail waar je deze kunt vinden.'),
    bol('Wil je iets aanpassen? Klik dan op ‘Feedback geven’ in de e-mail. Beantwoord de e-mail niet rechtstreeks, maar gebruik altijd deze knop. Zo wordt je feedback automatisch aan de juiste aanvraag gekoppeld.'),
    beeld_w=3300))
B.append(stap('g51-feedback',
    bol('Je aanvraag is al geselecteerd wanneer het formulier opent. Je hoeft dus niet opnieuw te zoeken.'),
    bol('Selecteer je naam en klik op ‘Volgende’.'),
    bol('Geef je feedback zo volledig mogelijk door en voeg indien nodig bestanden toe. Je kunt ook een nieuwe deadline doorgeven of een ander menu kiezen. Dit werkt op dezelfde manier als eerder beschreven.'),
    bol('Zodra je feedback is verwerkt, ontvang je opnieuw een e-mail. Hierin vind je de aangepaste versie, bijvoorbeeld met het onderwerp ‘Versie 2 klaar’.')))

# 5
B.append(kop1('5.  Aanvullen of wijzigen'))
B.append(intro('Iets vergeten, een extra design nodig of is de datum gewijzigd? Pas dan je bestaande aanvraag aan. Klik op het startscherm op ‘Iets aanvullen of wijzigen’ en kies voor ‘Voor een evenement’ of ‘Intern’.'))
B.append(stap('g40-aanv-zoek',
    bol('Zoek de juiste aanvraag. Typ minimaal drie letters van de eventnaam en selecteer de juiste aanvraag. Je ziet aanvragen van de afgelopen vier maanden, ook die van collega’s.'),
    bol('Vul daarna je naam in, zodat marketing weet wie de wijziging doorgeeft.'),
    bol('Bij een interne aanvraag vul je eerst je naam in en selecteer je de gewenste aanvraag uit je eigen aanvragen.')))
B.append(stap('g41-aanv-wat',
    bol('Beschrijf wat je wilt aanvullen of wijzigen. Geef duidelijk aan wat erbij moet of wat er anders moet.'),
    bol('Je kunt ook bestanden toevoegen. Marketing ontvangt direct bericht van je wijziging.'),
    bol('Menu aanpassen is alleen beschikbaar bij aanvragen voor een menukaart of menuscherm. Je krijgt dan hetzelfde menuoverzicht als in hoofdstuk 3, met het huidige menu al ingevuld. Pas aan wat nodig is.'),
    bol('Is de eventdatum of deadline gewijzigd? Klik dan op ‘Wijzigen’ bij de datum en voer de nieuwe datum in.')))
B.append(stap('g43-aanv-verlopen',
    bol('Is de deadline al verstreken? Dan verschijnt er een melding.'),
    bol('Kies eerst een nieuwe deadline. Zonder nieuwe deadline kun je de wijziging niet versturen.')))

# 6
B.append(kop1('6.  Spoed en vragen'))
B.append(intro('Je aanvraag komt bij marketing binnen als taak. Marketing ontvangt een e-mail en ziet de aanvraag in de lijst. Vervolgens plant marketing de aanvraag in. Is er iets onduidelijk, dan neemt marketing contact met je op. Zodra het design klaar is, ontvang je een e-mail met de bestanden (zie hoofdstuk 4).'))
B.append(kop2('Krappe deadlines'))
B.append(tabel(None, [
    ('10 werkdagen of meer tot het event', 'Je bent op tijd.'),
    ('Minder dan 10 werkdagen tot het event', 'De aanvraag geldt als spoed. Besteld drukwerk (zoals een geprinte menukaart, vlaggen, banners en roll-ups) is waarschijnlijk niet meer op tijd klaar.'),
    ('Deadline binnen 5 werkdagen', 'Dien je aanvraag in en mail daarna meteen marketing om te bespreken wat nog mogelijk is.'),
]))
B.append(kader('Spoedaanvragen worden automatisch per aanvrager bijgehouden.', 'Ze blijven als spoed geregistreerd, ook als de datum later verschuift!'))
B.append(kop2('Wat doe je als…'))
B.append(tabel(None, [
    ('Je feedback wilt geven op een design', 'Gebruik de knop Feedback geven in de e-mail.'),
    ('Je iets bent vergeten in je aanvraag', 'Kies iets aanvullen of wijzigen.'),
    ('Je nog een design nodig hebt voor hetzelfde event', 'Kies iets aanvullen of wijzigen en vermeld in de toelichting wat erbij moet.'),
    ('Het menu verandert', 'Kies iets aanvullen of wijzigen en vervolgens Menu aanpassen.'),
    ('De datum is verschoven', 'Kies iets aanvullen of wijzigen en klik bij de datum op wijzigen.'),
    ('Je een nieuw event wilt aanmelden', 'Start een nieuwe aanvraag via start.'),
    ('Je je aanvraag niet kunt vinden', 'Is de aanvraag ouder dan 4 maanden of is deze niet via het formulier ingediend? Mail dan marketing.'),
    ('De aanvraag niet doorgaat', 'Mail marketing, zodat de aanvraag kan worden verwijderd.'),
]))
B.append(kader('Twijfel je?', 'Mail marketing@nbcevents.nl (voor Green Village: marketing@green-village.nl). Liever even vragen dan gokken!'))

# ── In elkaar zetten ─────────────────────────────────────────────────────────
werk = UIT + '.d'
shutil.rmtree(werk, ignore_errors=True); shutil.copytree(SJABLOON, werk)
doc = open(f'{SJABLOON}/word/document.xml', encoding='utf-8').read()
kopstuk = doc[:doc.index('<w:body>') + len('<w:body>')]
sect = doc[doc.rindex('<w:sectPr'):doc.index('</w:body>')]
open(f'{werk}/word/document.xml', 'w', encoding='utf-8').write(kopstuk + ''.join(B) + sect + '</w:body></w:document>')

rels = open(f'{SJABLOON}/word/_rels/document.xml.rels', encoding='utf-8').read()
rels = re.sub(r'<Relationship Id="[^"]*" Type="[^"]*/image" Target="media/[^"]*"/>', '', rels)
rels = re.sub(r'<Relationship Id="rIdL\d+"[^>]*/>', '', rels)
for rid, url in koppelingen:
    rels = rels.replace('</Relationships>', f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{escape(url)}" TargetMode="External"/></Relationships>')
for f in os.listdir(f'{werk}/word/media'):
    if f not in ('image14.emf', 'image15.png'): os.remove(f'{werk}/word/media/{f}')
for rid, naam in beelden:
    if not os.path.exists(f'{werk}/word/media/{naam}'): shutil.copy(os.path.join(SHOTS, naam), f'{werk}/word/media/{naam}')
    rels = rels.replace('</Relationships>', f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{naam}"/></Relationships>')
open(f'{werk}/word/_rels/document.xml.rels', 'w', encoding='utf-8').write(rels)

core = open(f'{werk}/docProps/core.xml', encoding='utf-8').read()
core = re.sub(r'<dc:title>.*?</dc:title>', '<dc:title>Designs aanvragen bij Marketing - Handleiding voor projecten</dc:title>', core)
open(f'{werk}/docProps/core.xml', 'w', encoding='utf-8').write(core)

if os.path.exists(UIT): os.remove(UIT)
with zipfile.ZipFile(UIT, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(f'{werk}/[Content_Types].xml', '[Content_Types].xml')
    for root, _, files in os.walk(werk):
        for f in files:
            full = os.path.join(root, f); rel = os.path.relpath(full, werk)
            if rel != '[Content_Types].xml': z.write(full, rel)
shutil.rmtree(werk); shutil.rmtree(SJABLOON)
subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', os.path.dirname(UIT), UIT], check=True, capture_output=True)
print(os.path.normpath(UIT), len(beelden), 'beelden, en de PDF ernaast')
