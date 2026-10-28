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

def p(t='', ppr=''):
    return f'<w:p><w:pPr>{ppr}</w:pPr>{runs(t)}</w:p>'

def kop1(t):
    return f'<w:p><w:pPr><w:pStyle w:val="Kop1"/><w:pageBreakBefore/></w:pPr>{runs(t)}</w:p>'

def kop2(t, voor=240):
    return f'<w:p><w:pPr><w:pStyle w:val="Kop2"/><w:keepNext/><w:spacing w:before="{voor}"/></w:pPr>{runs(t)}</w:p>'

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
    return (f'<w:p><w:pPr><w:keepNext/>{KADER}<w:spacing w:before="160" w:after="0"/></w:pPr><w:r><w:rPr>{BOLD}</w:rPr><w:t xml:space="preserve">{escape(kop)}</w:t></w:r></w:p>'
            f'<w:p><w:pPr><w:keepNext/>{KADER}<w:spacing w:after="0"/></w:pPr>{runs(tekst)}</w:p>'
            f'<w:p><w:pPr>{KADER}<w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>')

def lijstpunt(t):
    return f'<w:p><w:pPr><w:pStyle w:val="Lijstalinea"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr><w:spacing w:after="60"/></w:pPr>{runs(t)}</w:p>'

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

BEELD_W, BREEDTE = 5500, 9015
def stap(naam, *regels, beeld_w=BEELD_W):
    """Screenshot links, uitleg rechts - zoals de drankgids, maar met een breder beeld voor het computerscherm."""
    tekst = ''.join(regels)
    BEELD_W, TEKST_W = beeld_w, BREEDTE - beeld_w
    return (f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>{GEEN_RAND}</w:tblPr><w:tblGrid><w:gridCol w:w="{BEELD_W}"/><w:gridCol w:w="{TEKST_W}"/></w:tblGrid>'
            f'<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="{BEELD_W}" w:type="dxa"/><w:tcMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>'
            f'<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>{beeld(naam, BEELD_W)}</w:p></w:tc>'
            f'<w:tc><w:tcPr><w:tcW w:w="{TEKST_W}" w:type="dxa"/><w:tcMar><w:top w:w="120" w:type="dxa"/><w:left w:w="240" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/></w:tcPr>'
            f'{tekst}</w:tc></w:tr></w:tbl>' + p('', '<w:spacing w:after="0" w:line="200" w:lineRule="exact"/>'))

def cel(w, inhoud, vul=None, mar='<w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tcMar>'):
    shd = f'<w:shd w:val="clear" w:color="auto" w:fill="{vul}"/>' if vul else ''
    return f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{shd}{mar}</w:tcPr>{inhoud}</w:tc>'

def tabel(kop, rijen, ws=(3200, 5815)):
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
    rows = r(kop, True) + ''.join(r([f'**{a}**', b]) for a, b in rijen)
    return f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>{GEEN_RAND}</w:tblPr><w:tblGrid>{grid}</w:tblGrid>{rows}</w:tbl>'

def inhoud(rijen):
    mar = '<w:tcMar><w:top w:w="30" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>'
    out = ''
    for n, a, b in rijen:
        out += ('<w:tr>' + cel(510, f'<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Pockota Med" w:hAnsi="Pockota Med"/><w:color w:val="229D96"/><w:sz w:val="20"/></w:rPr><w:t>{n}</w:t></w:r></w:p>', mar=mar)
                + cel(3061, p(f'**{a}**', '<w:spacing w:after="20"/>'), mar=mar) + cel(5443, p(b, '<w:spacing w:after="20"/>'), mar=mar) + '</w:tr>')
    return f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>{GEEN_RAND}</w:tblPr><w:tblGrid><w:gridCol w:w="510"/><w:gridCol w:w="3061"/><w:gridCol w:w="5443"/></w:tblGrid>{out}</w:tbl>'

# ── Inhoud ───────────────────────────────────────────────────────────────────
MAIL = '**marketing@nbcevents.nl**'
B = []
B.append(p('', '<w:spacing w:before="200"/>'))
B.append(f'<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr>{BOLD}<w:color w:val="165E5A"/></w:rPr><w:t>HANDLEIDING VOOR PROJECTEN</w:t></w:r></w:p>')
B.append('<w:p><w:pPr><w:pStyle w:val="Kop1"/><w:spacing w:after="240" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:sz w:val="54"/></w:rPr><w:t>Designs aanvragen</w:t></w:r><w:r><w:rPr><w:sz w:val="54"/></w:rPr><w:br/><w:t>bij Marketing</w:t></w:r></w:p>')
B.append('<w:p><w:pPr><w:pStyle w:val="Kop2"/><w:spacing w:after="200"/></w:pPr><w:r><w:t>Kort en stap voor stap, op je computer</w:t></w:r></w:p>')
B.append(f'<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:rPr>{BOLD}<w:color w:val="F5A300"/></w:rPr><w:t>Oktober 2026</w:t></w:r></w:p>')
B.append(f'<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>{beeld("omslag", 7400)}</w:p>')
B.append('<w:p><w:pPr><w:pStyle w:val="Kop2"/><w:spacing w:before="240"/></w:pPr><w:r><w:t>In deze gids</w:t></w:r></w:p>')
B.append(inhoud([
    (1, 'Het formulier in het kort', 'het startscherm en vier afspraken'),
    (2, 'Aanvraag voor een event', 'van locatie tot Gelukt'),
    (3, 'Interne aanvraag', 'iets voor NBC of Green Village zelf'),
    (4, 'Menukaart of menuscherm', 'een pakket kiezen en aanpassen'),
    (5, 'Je design is klaar', 'de mail van Marketing en feedback geven'),
    (6, 'Aanvullen of wijzigen', 'iets vergeten, iets erbij of een nieuwe datum'),
    (7, 'Spoed en vragen', 'krappe datums en wat je doet als…'),
]))
B.append(p('De screenshots komen uit het formulier, met een verzonnen event. Een oranje kader met een nummer wijst aan waar je klikt; hetzelfde nummer staat in de tekst ernaast.', '<w:spacing w:before="200"/>'))

# 1
B.append(kop1('1  Het formulier in het kort'))
B.append(intro('Met het formulier vraag je een design aan bij Marketing. Je vindt het op **marketing-nbc.github.io/designaanvraag**. Zet die link bij je favorieten.'))
B.append(stap('g01-start',
    nummer(1, '**Start**: een nieuwe aanvraag.'),
    nummer(2, '**Iets aanvullen of wijzigen**: voor een aanvraag die je al hebt gedaan (hoofdstuk 6).')))
B.append(stap('g02-vraag',
    nummer(1, 'Eén vraag per scherm, met uitleg eronder.'),
    nummer(2, 'Klik een antwoord aan, of druk op de **letter** ervoor.'),
    nummer(3, '**Volgende**, of druk op **Enter**.'),
    nummer(4, 'Terug naar een vorige vraag. De teller laat zien hoe ver je bent.'),
    bol('Je antwoorden worden bewaard. Sluit je het venster, dan ga je later verder waar je was.')))
B.append(kop2('Vier afspraken', 160))
B.append(lijstpunt('**Vraag minimaal 10 werkdagen vóór het event aan.** Korter is een spoedje, en dat wordt bijgehouden.'))
B.append(lijstpunt('**Eén aanvraag per event.** Vink alles aan wat je nodig hebt, dan staat het bij elkaar.'))
B.append(lijstpunt('**Feedback en wijzigingen gaan via het formulier**: met de knop Feedback geven in de mail van Marketing, of met Iets aanvullen of wijzigen. Niet via mail, Teams of WhatsApp.'))
B.append(lijstpunt('**Kies standaard designs**, tenzij de opdrachtgever om een eigen ontwerp vraagt of ervoor betaalt.'))
B.append(kader('Green Village', 'Kies bij de eerste vraag Green Village. Het formulier werkt verder hetzelfde; je kunt alleen geen LED-kolom aanvragen. Het postvak is marketing@green-village.nl.'))

# 2
B.append(kop1('2  Aanvraag voor een event'))
B.append(intro('Klik op **Start** en kies de locatie. Kies je **naam** uit de lijst; sta je er niet tussen, typ hem dan gewoon. Kies **Voor een evenement** en vul de naam van het event in zoals de opdrachtgever hem gebruikt.'))
B.append(stap('g03-eventdatum',
    nummer(1, 'Blader naar de goede maand.'),
    nummer(2, 'Klik de **eventdatum** aan. Duurt het event meer dagen, kies dan de eerste dag.'),
    nummer(3, 'Ben je op tijd, dan zegt het formulier dat ook.'),
    bol('Daarna kies je net zo de **deadline**: de dag waarop het design klaar moet zijn. Die ligt niet na het event.')))
B.append(stap('g04-krap',
    nummer(1, 'Is het event of de deadline over **3 werkdagen of minder**, dan zie je een rode melding. Vul het formulier gewoon in en mail daarna meteen Marketing.'),
    bol('Event over minder dan **twee weken**? Dan krijg je een oranje melding: drukwerk dat we bestellen, zoals een geprinte menukaart, vlaggen, banners en roll-ups, is dan waarschijnlijk niet meer op tijd.'),
    bol('Deadline over minder dan 5 werkdagen? Dan krijg je ook een melding. Je kunt door, maar overleg even met Marketing.')))
B.append(stap('g06-bestanden',
    nummer(1, 'Sleep een logo, voorbeelden of een briefing hierheen, of klik om te kiezen.'),
    nummer(2, 'Staat er een vinkje, dan gaat het bestand mee.'),
    bol('Afbeeldingen, PDF, Word en PowerPoint; hooguit 5 bestanden van 25 MB. Grotere bestanden en bronbestanden (AI, PSD, INDD) zet je op de schijf.'),
    bol('Daarvoor vraagt het formulier naar de **website** van het bedrijf of het event (daar halen we logo, kleuren en fonts vandaan) en naar de map op de **G:\\-schijf**. Allebei mag leeg blijven.')))
B.append(stap('g07-types',
    nummer(1, 'Vink **alles** aan wat je voor dit event nodig hebt, of druk op de letters.'),
    bol('Staat het er niet bij? Kies **Anders, namelijk…** en typ wat het is.'),
    bol('Een menukaart of menuscherm? Zie hoofdstuk 4.')))
B.append(stap('g08-modus',
    nummer(1, '**Standaard designs**: onze vaste templates, ingevuld met de gegevens van het event. Dit kies je meestal.'),
    nummer(2, '**Volledig custom**: alleen als de opdrachtgever om een eigen ontwerp vraagt of ervoor betaalt.')))
B.append(stap('g09-wensen',
    nummer(1, 'Teksten, sfeer, formaten, en alles wat Marketing moet weten. Enter geeft hier een nieuwe regel.'),
    nummer(2, '**Naar overzicht**.'),
    bol('Moet een collega de mail krijgen als het design klaar is? Zet zijn of haar naam en mailadres hier.')))
B.append(stap('g10-overzicht',
    nummer(1, '**wijzig**: pas een antwoord aan. Daarna kom je terug op het overzicht.'),
    nummer(2, '**Verstuur aanvraag**.')))
B.append(stap('g11-gelukt',
    nummer(1, 'Je aanvraag staat bij Marketing.'),
    nummer(2, 'De huisstijl wordt op de achtergrond opgehaald. Je hoeft niet te wachten; je kunt het venster sluiten.'),
    bol('Was het krap, dan staat hier nog een keer dat je Marketing moet mailen.'),
    bol('Iets vergeten? Doe geen tweede aanvraag, maar gebruik **Iets aanvullen of wijzigen** (hoofdstuk 6).')))

# 3
B.append(kop1('3  Interne aanvraag'))
B.append(intro('Voor iets zonder event, zoals visitekaartjes of een poster voor de kantine. Locatie en naam gaan zoals in hoofdstuk 2. Kies daarna **Intern**; dan zijn het nog maar twee vragen.'))
B.append(stap('g21-intern-wens',
    nummer(1, 'Beschrijf alles in één keer: wat het is, formaat, teksten en voor wie.')))
B.append(stap('g22-intern-deadline',
    nummer(1, 'Kies de dag waarop je het nodig hebt…'),
    nummer(2, '…of **Geen deadline** als het geen haast heeft. Het mag dan klaar zijn wanneer het past.'),
    bol('Komt er later toch een datum? Die geef je door met Iets aanvullen of wijzigen.')))

# 4
B.append(kop1('4  Menukaart of menuscherm'))
B.append(intro('Vink je bij **Wat wil je aanvragen?** **Menukaart print** of **Menu scherm** aan (of allebei), dan komt er één vraag bij: welk menu het is.'))
B.append(stap('g31-menu-pakket',
    nummer(1, 'Kies het **pakket**. Onder de naam zie je welke gangen erin zitten.')))
B.append(stap('g32-menu-inhoud',
    nummer(1, '**Wissel**: kies een ander gerecht.'),
    nummer(2, '**×**: haal een gerecht weg.'),
    nummer(3, '**+ Gerecht toevoegen**.'),
    nummer(4, '**Pakket wijzigen**: opnieuw kiezen.'),
    bol('Kies gerechten uit de lijst. Typ je zelf een gerecht, dan krijg je een melding en kijkt Marketing ernaar.'),
    bol('Verandert het menu later nog? Dat doe je met **Menu aanpassen** (hoofdstuk 6).')))

# 5
B.append(kop1('5  Je design is klaar'))
B.append(intro('Is het design klaar, dan krijg je een mail van **Designaanvraag** (designaanvraag@nbcevents.nl).'))
B.append(stap('g50-mail',
    nummer(1, 'Het onderwerp begint met **Klaar**, met het event en wat je hebt aangevraagd. Een volgende versie heet **Versie 2 klaar**.'),
    nummer(2, 'De **bestanden** zitten als bijlage bij de mail. Grote drukbestanden staan op de schijf; Marketing zet in de mail waar.'),
    nummer(3, '**Feedback geven**: iets aan te passen? Klik hierop.'),
    bol('Antwoord niet op de mail, maar gebruik de knop. Dan komt je feedback meteen bij de juiste aanvraag.'),
    beeld_w=4300))
B.append(stap('g51-feedback',
    nummer(1, 'Het formulier opent met je aanvraag al gekozen. Zoeken hoeft niet.'),
    nummer(2, 'Kies je **naam** en klik op Volgende.'),
    bol('Daarna typ je je feedback, met eventueel bestanden, een nieuwe deadline of een ander menu. Dat werkt zoals in hoofdstuk 6.'),
    bol('Is je feedback verwerkt, dan krijg je weer een mail: **Versie 2 klaar**.')))

# 6
B.append(kop1('6  Aanvullen of wijzigen'))
B.append(intro('Iets vergeten, komt er een design bij, of is een datum verschoven? Dat hoort bij je bestaande aanvraag. Klik op het startscherm op **Iets aanvullen of wijzigen** en kies **Voor een evenement** of **Intern**.'))
B.append(stap('g40-aanv-zoek',
    nummer(1, 'Typ minstens 3 letters van de **eventnaam**.'),
    nummer(2, 'Klik de aanvraag aan.'),
    bol('Je ziet de aanvragen van de afgelopen 4 maanden, ook die van collega’s.'),
    bol('Intern? Dan vul je je naam in en kies je uit je eigen aanvragen.'),
    bol('Daarna vul je je naam in, zodat Marketing weet van wie het komt.')))
B.append(stap('g41-aanv-wat',
    nummer(1, 'Wat moet erbij of anders. Marketing krijgt er meteen bericht van.'),
    nummer(2, 'Bestanden meesturen.'),
    nummer(3, '**Menu aanpassen**: alleen bij een menukaart of menuscherm. Je krijgt hetzelfde menuscherm als in hoofdstuk 4, met het menu dat er nu staat.')))
B.append(stap('g42-aanv-extra',
    nummer(1, 'Is de eventdatum of deadline verschoven? Klik op **wijzigen**.'),
    nummer(2, 'Een map op de schijf of een WeTransfer-link.'),
    bol('Alles op dit scherm mag leeg blijven. Klik op **Versturen**.')))
B.append(stap('g43-aanv-verlopen',
    nummer(1, 'Is de deadline al voorbij, dan zie je deze melding.'),
    nummer(2, 'Kies eerst een **nieuwe deadline**. Zonder nieuwe deadline kun je niet versturen.')))

# 7
B.append(kop1('7  Spoed en vragen'))
B.append(intro('Je aanvraag komt bij Marketing binnen als taak.'))
B.append(nummer(1, 'Marketing krijgt een mail en ziet je aanvraag in de lijst.'))
B.append(nummer(2, 'Marketing plant hem in. Is er iets onduidelijk, dan nemen ze contact met je op.'))
B.append(nummer(3, 'Is het design klaar, dan krijg je een mail met de bestanden (hoofdstuk 5).'))
B.append(kop2('Krappe datums'))
B.append(tabel(('Hoeveel tijd', 'Wat het formulier zegt'), [
    ('10 werkdagen of meer tot het event', 'Je bent op tijd.'),
    ('Minder dan 10 werkdagen tot het event', 'Een spoedje. Drukwerk dat we bestellen (geprinte menukaart, vlaggen, banners, roll-ups) is waarschijnlijk niet meer op tijd.'),
    ('Deadline over minder dan 5 werkdagen', 'Overleg even met Marketing als het sneller moet.'),
    ('3 werkdagen of minder', 'Verstuur je aanvraag en mail daarna meteen Marketing om te bespreken wat er nog kan.'),
]))
B.append(p('Spoedjes worden automatisch bijgehouden, per aanvrager, en blijven staan als de datum later verschuift.', '<w:spacing w:before="160"/>'))
B.append(kop2('Wat doe je als…'))
B.append(tabel(('Wat er is', 'Zo doe je het'), [
    ('Feedback op een design', 'De knop Feedback geven in de mail (hoofdstuk 5).'),
    ('Iets vergeten in je aanvraag', 'Iets aanvullen of wijzigen.'),
    ('Nog een design voor hetzelfde event', 'Iets aanvullen of wijzigen, en zet in de toelichting wat erbij moet.'),
    ('Het menu verandert', 'Iets aanvullen of wijzigen, en dan Menu aanpassen.'),
    ('Datum verschoven', 'Iets aanvullen of wijzigen, en klik bij de datum op wijzigen.'),
    ('Een nieuw event', 'Een nieuwe aanvraag met Start.'),
    ('Je vindt je aanvraag niet', 'Ouder dan 4 maanden, of niet via het formulier gedaan? Mail Marketing.'),
    ('Aanvraag gaat niet door', 'Mail Marketing, dan halen zij hem weg.'),
]))
B.append(p(f'**Twijfel je?** Mail {MAIL} (Green Village: **marketing@green-village.nl**). Liever even vragen dan gokken.', '<w:spacing w:before="240"/>'))

# ── In elkaar zetten ─────────────────────────────────────────────────────────
werk = UIT + '.d'
shutil.rmtree(werk, ignore_errors=True); shutil.copytree(SJABLOON, werk)
doc = open(f'{SJABLOON}/word/document.xml', encoding='utf-8').read()
kopstuk = doc[:doc.index('<w:body>') + len('<w:body>')]
sect = doc[doc.rindex('<w:sectPr'):doc.index('</w:body>')]
open(f'{werk}/word/document.xml', 'w', encoding='utf-8').write(kopstuk + ''.join(B) + sect + '</w:body></w:document>')

rels = open(f'{SJABLOON}/word/_rels/document.xml.rels', encoding='utf-8').read()
rels = re.sub(r'<Relationship Id="[^"]*" Type="[^"]*/image" Target="media/[^"]*"/>', '', rels)
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
