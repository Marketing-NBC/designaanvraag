"""Bouwt de marketinggids 'Designaanvragen in Asana' en zet hem om naar PDF.

De opmaak (stijlen, kop- en voettekst met het NBC-logo) komt uit het Word-bestand van de
projectengids. De tekst staat hieronder; de beelden komen uit bron/kader/ (zie asana.py en
mails.cjs).

    python3 docs/gids-marketing/bron/bouw.py
"""
import os, re, shutil, subprocess, sys, tempfile, zipfile
from xml.sax.saxutils import escape
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
NAAM = 'Designaanvragen in Asana - Handleiding voor Marketing'
UIT = os.path.join(HIER, '..', NAAM + '.docx')
SHOTS = os.path.join(HIER, 'kader')
SJABLOON = tempfile.mkdtemp()
with zipfile.ZipFile(os.path.join(HIER, '..', '..', 'gids-projecten', 'Designs aanvragen - Handleiding voor projecten.docx')) as z:
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

def breed(naam, *regels, beeld_w=BREEDTE):
    """Een breed beeld over de hele breedte, met de uitleg eronder."""
    return (f'<w:p><w:pPr><w:keepNext/><w:spacing w:after="120"/></w:pPr>{beeld(naam, beeld_w)}</w:p>'
            + ''.join(regels) + p('', '<w:spacing w:after="0" w:line="200" w:lineRule="exact"/>'))

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
SMAL = 4300  # de uitsneden van het taakpaneel in Asana zijn hoog en smal
MAIL = 4600  # de nagemaakte mails
TEAL = '229D96'

def link(tekst, rid):
    """Een link die al in het sjabloon staat: rId8 = het formulier, rId9/10/11 = de postvakken."""
    return (f'<w:hyperlink r:id="{rid}"><w:r><w:rPr><w:color w:val="{TEAL}"/><w:u w:val="single"/></w:rPr>'
            f'<w:t xml:space="preserve">{escape(tekst)}</w:t></w:r></w:hyperlink>')

def pl(*delen, ppr=''):
    """Een alinea uit stukken tekst (met **vet**) en links."""
    return f'<w:p><w:pPr>{ppr}</w:pPr>' + ''.join(d if d.startswith('<w:hyperlink') else runs(d) for d in delen) + '</w:p>'

B = []
# Pagina 1: de afspraken, zoals op de eerste pagina van de gids voor projecten
B.append(f'<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr>{BOLD}<w:color w:val="{TEAL}"/></w:rPr><w:t xml:space="preserve">HANDLEIDING VOOR MARKETING  NOVEMBER 2026</w:t></w:r></w:p>')
B.append('<w:p><w:pPr><w:pStyle w:val="Kop1"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:sz w:val="54"/></w:rPr><w:t>Designaanvragen in Asana</w:t></w:r></w:p>')
B.append(pl('Collega’s vragen designs aan via het formulier ', link('Designaanvraag', 'rId8'),
            '. Elke aanvraag wordt een taak in het Asana-project **Designaanvragen**. Deze handleiding legt uit hoe de tool werkt, '
            'wat je in Asana doet en hoe we samen te werk gaan. Eerst de afspraken; daarna de volledige uitleg met screenshots.'))
B.append(kop2('1. Alles loopt via het formulier', 200))
B.append(lijstpunt('Krijg je een aanvraag, feedback of wijziging via de mail, Teams of WhatsApp? Stuur de collega naar het formulier. Dan komt alles bij de juiste taak terecht.'))
B.append(lijstpunt('Nieuw design: **start** in het formulier. Iets vergeten, een extra design of een andere datum: **Iets aanvullen of wijzigen**. Feedback op een design: de knop **Feedback geven** in de mail.'))
B.append(lijstpunt('Wil een collega een aanvraag doen maar staat hij niet in de namenlijst? Voeg hem toe, met zijn mailadres (hoofdstuk 10).'))
B.append(kop2('2. Plan elke aanvraag in'))
B.append(lijstpunt('Houd de kolommen **Nieuwe aanvragen** en **Feedback** leeg: sleep een taak naar **In planning** en kies een **vervaldatum**, de dag waarop je eraan werkt.'))
B.append(lijstpunt('Plan vóór de **deadline** van de aanvrager. De deadline staat in het veld Deadline en in de deadline-agenda.'))
B.append(lijstpunt('Deadline binnen **5 werkdagen**, of is iets onduidelijk? Beoordeel wat haalbaar is en neem contact op met de aanvrager. Dat staat ook zo in de handleiding voor projecten.'))
B.append(kop2('3. Lever op via de subtaak Oplevering'))
B.append(lijstpunt('Mail nooit zelf bestanden. Zet tekst en bestanden in de subtaak **Oplevering**, stuur eerst een **proef naar jezelf** en dan pas **Verstuur nu**.'))
B.append(lijstpunt('Vraagt de aanvrager of een collega de mail ook krijgt? Zet die in het veld **Ook mailen naar**.'))
B.append(kop2('4. Af is pas af bij akkoord'))
B.append(lijstpunt('**Klaar** is opgeleverd en wacht op akkoord. **Afgerond** is opgeleverd én akkoord. Tot er akkoord of feedback is, krijgt de aanvrager elke werkdag een herinnering.'))
B.append(lijstpunt('Akkoord gekregen per telefoon of in de gang? Sleep de taak zelf naar **Afgerond**. Dan stoppen de herinneringen.'))
B.append(lijstpunt('Verplaats taken altijd door te **slepen**, niet door ze los af te vinken. Alleen slepen houdt het vinkje, de deadline-agenda en de weekmail goed.'))
B.append(kop2('5. Houd het overzicht'))
B.append(lijstpunt('Lees op maandag het **weekoverzicht** in het marketingpostvak: deadlines van deze week en wat blijft liggen.'))
B.append(lijstpunt('Gaat een aanvraag niet door? Verwijder de taak in Asana. Dan vervalt de aanvraag ook in het formulier.'))
B.append(kop2('Hulp nodig of twijfel je?'))
B.append(p('Abel beheert de tool. Hoofdstuk 10 zegt wat je doet als iets niet werkt. Wat collega’s zelf zien en doen, staat in de **handleiding voor projecten**.'))

B.append('<w:p><w:pPr><w:pStyle w:val="Kop2"/><w:pageBreakBefore/></w:pPr><w:r><w:t>In deze handleiding</w:t></w:r></w:p>')
B.append(inhoud([
    (1, 'Zo werkt de tool', 'van formulier tot Asana, en wat de aanvrager ziet'),
    (2, 'Het bord', 'de vijf kolommen'),
    (3, 'De taak lezen', 'taaknaam, velden, beschrijving en huisstijl'),
    (4, 'Inplannen', 'vervaldatum, Werkplanning en deadlines'),
    (5, 'Menuscherm maken', 'met één veld op de taak, ook in het Engels'),
    (6, 'Opleveren', 'de subtaak Oplevering, de proef en de 3D-ledkolom'),
    (7, 'Akkoord en herinneringen', 'van Klaar naar Afgerond'),
    (8, 'Feedback en aanvullingen', 'wat er gebeurt als er iets binnenkomt'),
    (9, 'Mails en het weekoverzicht', 'wat er in het marketingpostvak komt'),
    (10, 'Als iets niet werkt', 'voor wie Abel vervangt'),
]))
B.append(p('De screenshots komen uit Asana en Outlook, met een voorbeeldaanvraag voor het verzonnen event Zorgcongres 2026. Een oranje kader met een nummer wijst iets aan; hetzelfde nummer staat in de tekst ernaast.', '<w:spacing w:before="200"/>'))

# 1
B.append(kop1('1  Zo werkt de tool').replace('<w:pageBreakBefore/>', '<w:spacing w:before="480"/>'))  # loopt door onder de inhoud
B.append(intro('Collega’s vragen een design aan via het formulier op **marketing-nbc.github.io/designaanvraag**. Daarna gaat het grotendeels vanzelf:'))
B.append(nummer(1, 'Er komt een **taak** in het project **Designaanvragen**, in de kolom Nieuwe aanvragen, met per gevraagd design een subtaak.'))
B.append(nummer(2, 'Het marketingpostvak krijgt een **mail**, en de aanvrager een **bevestiging** met een knop om later iets aan te vullen.'))
B.append(nummer(3, 'Is er een website opgegeven, dan wordt de **huisstijl** van de opdrachtgever opgehaald en bij de taak gezet.'))
B.append(nummer(4, 'Jij plant de taak in, maakt het design en levert op via de subtaak **Oplevering**. De aanvrager krijgt een mail met de bestanden en twee knoppen: **Feedback geven** en **Akkoord geven**.'))
B.append(nummer(5, 'Komt er feedback, dan zet het systeem de taak terug in beeld (hoofdstuk 8). Komt er akkoord, dan gaat de taak naar **Afgerond** (hoofdstuk 7).'))
B.append(kop2('Wat de aanvrager doet', 160))
B.append(bol('Kiest de locatie en zijn **naam**: alleen wie in de namenlijst staat, kan een aanvraag doen, aanvullen, feedback of akkoord geven.'))
B.append(bol('Kiest **evenement** of **intern**. Een interne aanvraag is één tekstvak en een datum, of **Geen deadline**.'))
B.append(bol('Kiest bij een evenement de eventdatum, de deadline, standaard of custom, en wat er nodig is. Valt het event binnen twee weken, dan ziet hij een oranje melding; binnen 5 werkdagen een rode.'))
B.append(bol('Kiest bij een menukaart of menuscherm het **pakket** en de taal (Nederlands of Engels), en past gerechten aan.'))
B.append(bol('Vult later aan via **Iets aanvullen of wijzigen**, en reageert op een oplevering met **Feedback geven** of **Akkoord geven**.'))
B.append(stap('mail-bevestiging',
    nummer(1, 'De **bevestiging** aan de aanvrager: Ontvangen, met wat er is aangevraagd. Alleen als er bij zijn naam een mailadres staat.'),
    nummer(2, 'Hoe het verder gaat: inplannen, oplevering, akkoord.'),
    nummer(3, '**Iets aanvullen of wijzigen** opent het formulier met deze aanvraag al gekozen.'),
    beeld_w=MAIL))
B.append(stap('mail-nieuwe-aanvraag',
    nummer(1, 'De mail aan Marketing. Het onderwerp: event, eventdatum en wat er gevraagd is. Bij een spoedje staat er **[SPOED]** voor.'),
    nummer(2, '**Spoed**: minder dan 10 werkdagen tussen de aanvraag en het event (bij intern: de deadline).'),
    nummer(3, '**Open de taak in Asana**.'),
    bol('Staat er **[Niet in Asana]** in het onderwerp, dan lukte het maken van de taak niet. Alle gegevens staan dan in de mail; maak de taak zelf aan.'),
    beeld_w=MAIL))
B.append(kader('Green Village', 'Het veld Locatie zegt of een aanvraag voor NBC of Green Village is. Green Village-aanvragen komen in hetzelfde project, maar de mails gaan naar marketing@green-village.nl, met een eigen weekoverzicht en in de groene GV-kleuren.'))

# 2
B.append(kop1('2  Het bord'))
B.append(intro('Open het project **Designaanvragen** en kies **Bord**. Een taak gaat van links naar rechts.'))
B.append(breed('m01-bord',
    nummer(1, '**Nieuwe aanvragen**: net binnen, nog niet ingepland.'),
    nummer(2, '**Feedback**: er kwam feedback op werk dat al af was. Hier zet het systeem een taak zelf neer (hoofdstuk 8).'),
    nummer(3, '**In planning**: ingepland met een vervaldatum; hier werk je eraan.'),
    nummer(4, '**Klaar**: opgeleverd, wacht op akkoord van de aanvrager.'),
    bol('**Afgerond**: opgeleverd én akkoord (hoofdstuk 7). Deze kolom staat rechts van Klaar; op de screenshot is hij er nog niet.'),
    bol('Slepen naar Klaar of Afgerond vinkt de taak af; eruit slepen haalt het vinkje weer weg.'),
    bol('Op de kaart zie je de belangrijkste velden: Soort (Evenement blauw, Intern roze), eventdatum, deadline, wat er gevraagd is en Spoed.')))

# 3
B.append(kop1('3  De taak lezen'))
B.append(intro('Klik een kaart aan. Rechts opent de taak.'))
B.append(stap('m02-taak',
    nummer(1, 'De **taaknaam**: event – eventdatum – aanvrager – deadline – wat. Bij meer dan één design staat er Meerdere designs. Een interne aanvraag begint met Intern.'),
    nummer(2, 'De **vervaldatum** is leeg: die kies jij bij het inplannen.'),
    nummer(3, 'De **kolom** op het bord.'),
    nummer(4, '**Spoed** wordt bij het indienen gezet en verandert daarna niet.'),
    nummer(5, '**Huisstijl**: Bezig, Klaar of Mislukt.'),
    nummer(6, '**Kleur** bepaalt de kleur in 4. Werkplanning (hoofdstuk 4).'),
    beeld_w=SMAL))
B.append(stap('m03-beschrijving',
    nummer(1, 'Alle gegevens uit het formulier.'),
    nummer(2, '**Wensen en bijzonderheden**, letterlijk zoals de aanvrager ze typte. Vraagt hij of een collega de oplevering ook krijgt, dan staat dat hier.'),
    nummer(3, '**Menu**: alleen bij een menukaart of menuscherm, met het pakket, en bij een Engels menu de taal. Dit is ook de bron voor het menuscherm (hoofdstuk 5).'),
    beeld_w=SMAL))
B.append(stap('m04-huisstijl',
    nummer(1, 'De **huisstijl** die van de website is gehaald: kleuren, fonts en stijl.'),
    nummer(2, 'De **huisstijlkaart**: alles op één plaatje.'),
    bol('Mislukt, of is de website veranderd? Zet het veld Huisstijl op **Haal opnieuw op**.'),
    bol('Lees de huisstijl als een startpunt; de kaart noemt zelf hoe zeker hij is.'),
    beeld_w=SMAL))
B.append(stap('m05-subtaken',
    nummer(1, '**Oplevering**: hiermee lever je op (hoofdstuk 6).'),
    nummer(2, 'Per gevraagd design een **subtaak**.'),
    nummer(3, '**Bijlagen**: het logo en de huisstijlkaart, en wat de aanvrager meestuurde.'),
    beeld_w=SMAL))

# 4
B.append(kop1('4  Inplannen'))
B.append(stap('m06-inplannen',
    nummer(1, 'Sleep de taak naar **In planning**…'),
    nummer(2, '…en kies een **vervaldatum**: de dag waarop jij eraan werkt.'),
    bol('De deadline van de aanvrager staat in het veld Deadline; de vervaldatum is jouw planning. Plan vóór de deadline.'),
    beeld_w=2600))
B.append(stap('m07-vervaldatum',
    nummer(1, 'De **vervaldatum** staat.'),
    nummer(2, 'Nu staat de taak in **twee projecten**…'),
    nummer(3, '…en in Designaanvragen in de kolom **In planning**.'),
    beeld_w=SMAL))
B.append(stap('m08-ingepland',
    nummer(1, 'Vergeten? Dan komt er een reactie met je naam: kies een vervaldatum.'),
    nummer(2, 'Met vervaldatum komt de taak vanzelf in **4. Werkplanning**.'),
    beeld_w=SMAL))
B.append(breed('m09-werkplanning',
    nummer(1, 'In **4. Werkplanning** staat de taak op de vervaldatum, in de kleur van het veld Kleur.')))
B.append(tabel(('Kleur', 'Wanneer'), [
    ('Evenement (aqua)', 'een evenement, op tijd'),
    ('Evenement spoed (oranje)', 'een evenement, minder dan 10 werkdagen'),
    ('Intern (roze)', 'een interne aanvraag, op tijd'),
    ('Intern spoed (paars)', 'een interne aanvraag, minder dan 10 werkdagen'),
    ('Reminder, NBC, GV', 'kies je zelf voor je eigen taken'),
]))
B.append(breed('m10-deadlines',
    nummer(1, 'In **Deadlines designaanvragen** staat elke aanvraag als mijlpaal op de **deadline** van de aanvrager. Hij schuift mee als de deadline verandert en verdwijnt als de taak is afgevinkt. Een interne aanvraag zonder deadline staat er niet in.')))

# 5
B.append(kop1('5  Menuscherm maken'))
B.append(intro('Hoort er een menuscherm bij, dan maakt het systeem het voor je. Hang eerst het **logo van de opdrachtgever** als bijlage aan de subtaak **Menu scherm …**. Zet daarna het veld op de **hoofdtaak**; op de subtaak doet het veld niets.'))
B.append(stap('m11-menuscherm',
    nummer(1, '**Menuscherm**: kies **Genereer nu** (NBC-kleuren) of **Genereer nu (kleuren opdrachtgever)**. Het veld springt op Bezig en daarna op Klaar of Mislukt.'),
    nummer(2, '**Menukleuren**: eigen kleuren als hexcode. Eén code voor de vlakken, twee voor vlakken en kopjes, drie ook voor de tekst: #5b2d8e, #ff6600, #1d1d1b.'),
    beeld_w=SMAL))
B.append(stap('m12-menuresultaat',
    nummer(1, 'Het **menuscherm** staat als bijlage bij de taak.'),
    nummer(2, 'De reactie noemt wat er is gebruikt en waar je op moet letten.'),
    bol('Heet de bijlage **NIET-BRUIKBAAR-…**, dan loopt er tekst over het ontwerp: een te lang gerecht.'),
    beeld_w=SMAL))
B.append(kader('Engels menu', 'Koos de aanvrager een Engels menu, dan staat er in de beschrijving Taal van het menu: Engels. Genereer nu maakt dan vanzelf het Engelse scherm, met het Engelse basisontwerp. Je hoeft niets anders te doen.'))
B.append(p('', '<w:spacing w:after="0"/>'))
B.append(kader('Een gerecht anders?', 'Pas het aan onder het kopje Menu in de beschrijving en kies opnieuw Genereer nu. Laat het kopje en het citaatblok staan. Let op: past de aanvrager het menu later aan via Menu aanpassen in het formulier, dan vervangt dat jouw aanpassing.'))

# 6
B.append(kop1('6  Opleveren'))
B.append(intro('Is het design af, lever het dan op via de subtaak **Oplevering**. De aanvrager krijgt een mail met de bestanden en de knoppen **Feedback geven** en **Akkoord geven**.'))
B.append(stap('m13-oplevering',
    nummer(1, 'Open de subtaak **Oplevering**.'),
    nummer(2, 'De **beschrijving** wordt de tekst van de mail: wat er klaar is en waar de drukbestanden staan. Vet, lijstjes en links blijven staan.'),
    nummer(3, 'De **bijlagen** gaan precies zo mee. Samen hooguit **20 MB**; groter zet je op de schijf of in SharePoint, met de link in de tekst.'),
    beeld_w=SMAL))
B.append(stap('m14-oplevermail',
    nummer(1, 'Op de **hoofdtaak**: het veld **Oplevermail**.'),
    nummer(2, '**Stuur proef naar mij**: jij krijgt precies de mail die de aanvrager krijgt.'),
    nummer(3, '**Verstuur nu**: de echte mail.'),
    nummer(4, '**Ook mailen naar**: collega’s die de mail ook moeten krijgen, gescheiden door een komma. De aanvrager staat er vanzelf op. Alleen collega’s, geen klanten.'),
    beeld_w=SMAL))
B.append(stap('mail-proef',
    nummer(1, 'De proef heeft **[PROEF]** in het onderwerp.'),
    nummer(2, 'Bovenaan staat aan wie de echte mail gaat.'),
    nummer(3, '**Feedback geven** en…'),
    nummer(4, '…**Akkoord geven**. Klik in de proef op geen van beide: de knoppen werken echt.'),
    bol('Na een proef springt het veld op Proef verstuurd. Er wordt niets afgevinkt.'),
    beeld_w=MAIL))
B.append(stap('m16-verstuurd',
    nummer(1, 'Na **Verstuur nu** staat er een reactie met het verslag: aan wie en welke bijlagen.'),
    beeld_w=SMAL))
B.append(stap('m17-nieuwe-oplevering',
    nummer(1, 'Er staat een nieuwe, lege **Oplevering** klaar voor een volgende versie…'),
    nummer(2, '…en de verstuurde is afgevinkt en hernoemd naar **Oplevering versie 1 – verstuurd**.'),
    beeld_w=SMAL))
B.append(stap('m18-klaar',
    nummer(1, 'De taak gaat vanzelf naar **Klaar**…'),
    nummer(2, '…en wordt afgevinkt. Daar wacht hij op akkoord (hoofdstuk 7).'),
    bol('Mislukt het, dan gaat er niets de deur uit. Het veld springt op **Mislukt** en een reactie met je naam zegt waarom: de subtaak is leeg, er is geen ontvanger, de bestanden zijn te groot. Los het op en kies opnieuw Verstuur nu.'),
    bol('Een volgende versie lever je op vanuit de nieuwe subtaak. De mail heet dan **Versie 2 klaar**.'),
    beeld_w=2600))
B.append(kop2('Een LED-kolom: de 3D-preview', 160))
B.append(intro('Een ledkolomvideo is te groot voor Asana en de mail. De aanvrager krijgt daarom een knop **Bekijk in 3D**: de kolom in 3D en op de foto van de foyer.'))
B.append(nummer(1, 'Maak in de repository **NBC-3D-ledkolom-Preview** een release met de mp4, zoals je gewend bent.'))
B.append(nummer(2, 'Plak de link van die release **op een eigen regel** in de beschrijving van de subtaak Oplevering. Schrijf de rest zoals altijd.'))
B.append(nummer(3, 'Stuur een proef. De link komt niet in de mail; in de plaats daarvan staat de knop. Is de preview er nog niet, dan zegt de proef dat, en komt er een reactie zodra hij online staat.'))
B.append(nummer(4, 'Kies **Verstuur nu**. Is de preview nog niet klaar, dan gaat de mail vanzelf de deur uit zodra hij er is. Het veld blijft zo lang op Bezig.'))
B.append(bol('Een volgende versie is een nieuwe release, met de link in de nieuwe subtaak Oplevering.'))
B.append(bol('Staat de mail er na een kwartier nog niet? Kies opnieuw Verstuur nu.'))

# 7
B.append(kop1('7  Akkoord en herinneringen'))
B.append(intro('Na een oplevering wil je weten of het goed is. De aanvrager geeft akkoord met de gele knop in de opleveringsmail; zolang dat niet gebeurt en er geen feedback komt, krijgt hij elke werkdag een herinnering.'))
B.append(stap('mail-akkoord',
    nummer(1, 'Geeft de aanvrager akkoord, dan krijgt het marketingpostvak een mail **Akkoord: …**.'),
    nummer(2, 'Wie akkoord gaf, op welke versie. De taak staat al in **Afgerond**, afgevinkt, met een reactie wie en wanneer.'),
    nummer(3, '**Open de taak in Asana**.'),
    bol('Alleen de **aanvrager** kan akkoord geven. Wie de mail via Ook mailen naar kreeg, kan wel feedback geven.'),
    bol('Akkoord gaat altijd over de laatst verstuurde versie.'),
    beeld_w=MAIL))
B.append(stap('mail-herinnering',
    nummer(1, 'De **herinnering**: elke werkdag om 9:00, de eerste de werkdag na de oplevering.'),
    nummer(2, 'Met dezelfde knoppen: Feedback geven en Akkoord geven.'),
    nummer(3, 'Hij gaat naar iedereen die de opleveringsmail kreeg, zonder maximum.'),
    beeld_w=MAIL))
B.append(tabel(('De herinneringen stoppen als', 'Toelichting'), [
    ('de aanvrager akkoord geeft', 'De taak gaat vanzelf naar Afgerond.'),
    ('er feedback binnenkomt', 'Via Feedback geven of Iets aanvullen of wijzigen, en echt verstuurd. Alleen op de knop klikken telt niet.'),
    ('jij de taak naar Afgerond sleept', 'Voor een akkoord per telefoon, mail of in de gang.'),
    ('je een nieuwe versie verstuurt', 'Dan beginnen de herinneringen voor die versie.'),
]))
B.append(kader('Aanvragen van voor 4 november 2026', 'Die krijgen de opleveringsmail zoals vroeger: alleen Feedback geven, zonder akkoordknop en zonder herinneringen. Sleep zo’n taak zelf naar Afgerond als hij af is.'))

# 8
B.append(kop1('8  Feedback en aanvullingen'))
B.append(intro('Feedback komt binnen via de knop in de opleveringsmail of via Iets aanvullen of wijzigen in het formulier. Het komt als reactie bij de taak, en het marketingpostvak krijgt een mail.'))
B.append(stap('mail-aanvulling',
    nummer(1, 'Stond de taak in **Klaar**, dan is hij heropend.'),
    nummer(2, 'Wat de aanvrager schreef.'),
    nummer(3, '**Open de taak in Asana**.'),
    beeld_w=MAIL))
B.append(breed('m19-feedback-bord',
    nummer(1, 'Een taak die af was, gaat terug naar **Feedback**…'),
    nummer(2, '…zonder vinkje en zonder vervaldatum.')))
B.append(stap('m20-feedback-reactie',
    nummer(1, 'De reactie noemt je, zodat hij in je Asana-inbox komt. Kies een **nieuwe vervaldatum** en sleep de taak naar In planning. Lever de nieuwe versie op vanuit de nieuwe subtaak Oplevering.'),
    beeld_w=SMAL))
B.append(tabel(('Waar de taak staat', 'Wat er gebeurt bij een aanvulling'), [
    ('Nieuwe aanvragen of In planning', 'De taak blijft staan. De aanvulling komt als reactie: extra informatie.'),
    ('Klaar, Afgerond of afgevinkt', 'Naar Feedback, vinkje eraf, vervaldatum eraf, reactie met je naam.'),
    ('Datum verschoven', 'De velden Eventdatum of Deadline worden bijgewerkt; de mijlpaal schuift mee. Spoed verandert niet.'),
    ('Menu aangepast', 'Het kopje Menu in de beschrijving wordt vervangen. Genereer het menuscherm opnieuw.'),
    ('Extra design gevraagd', 'Het staat in de toelichting; het veld Type aanvraag verandert niet. Maak zelf een subtaak als dat helpt.'),
]))

# 9
B.append(kop1('9  Mails en het weekoverzicht'))
B.append(intro('Alles komt van **designaanvraag@nbcevents.nl**. Wat je zelf in Asana doet, levert geen mail op aan Marketing.'))
B.append(tabel(('Mail aan Marketing', 'Wanneer'), [
    ('Nieuwe aanvraag: …', 'Bij elke aanvraag. Met [SPOED] ervoor als het een spoedje is.'),
    ('Aanvulling: …', 'Bij elke aanvulling of feedback.'),
    ('Akkoord: …', 'Als de aanvrager akkoord geeft.'),
    ('[Niet in Asana]', 'De taak kon niet gemaakt worden; alles staat in de mail.'),
    ('Weekoverzicht', 'Elke maandag rond 8:00, per locatie.'),
]))
B.append(p('', '<w:spacing w:after="0"/>'))
B.append(tabel(('Mail aan de collega', 'Wanneer'), [
    ('Ontvangen: …', 'De bevestiging, direct na de aanvraag.'),
    ('Klaar: … / Versie 2 klaar: …', 'Als jij Verstuur nu kiest.'),
    ('Herinnering: wacht op je akkoord', 'Elke werkdag om 9:00, tot er akkoord of feedback is.'),
]))
B.append(p('Antwoordt een collega toch op een mail, dan komt dat in het marketingpostvak van de locatie. Wijs hem dan op de knop in de mail.', '<w:spacing w:before="160"/>'))
B.append(stap('mail-weekmail',
    nummer(1, '**Deadlines deze week**, per dag, met spoed gemarkeerd en of er al een vervaldatum is.'),
    nummer(2, '**Let op**: over de deadline, nog niet opgepakt, feedback die wacht, ingepland ná de deadline, en wat deze week af moet zonder vervaldatum.'),
    nummer(3, '**Volgende week**: een vooruitblik.'),
    bol('Is er niets te melden, dan komt er die week geen mail.'),
    bol('Wat in Klaar of Afgerond staat of is afgevinkt telt niet mee.'),
    beeld_w=SMAL))

# 10
B.append(kop1('10  Als iets niet werkt'))
B.append(intro('Abel is de beheerder. Voor wie hem vervangt:'))
B.append(tabel(('Wat er is', 'Zo los je het op'), [
    ('Een collega staat niet in de namenlijst', 'Supabase → project Designaanvraag → Table editor → collegas: voeg een rij toe met naam en e-mail. Naar dat adres gaan de bevestiging, de oplevering en de herinneringen.'),
    ('Een collega krijgt geen bevestiging of oplevering', 'Zet zijn e-mailadres in dezelfde tabel. Zonder adres gaat de oplevering alleen naar Ook mailen naar.'),
    ('Een collega is weg', 'Zet in dezelfde tabel actief uit.'),
    ('Een tikfout in Aanvrager', 'Voeg de opties in Asana samen, of haal de verkeerde weg.'),
    ('Een aanvraag hoeft niet meer', 'Verwijder de taak in Asana. De aanvraag vervalt dan ook in het formulier.'),
    ('Herinneringen moeten stoppen', 'Sleep de taak naar Afgerond.'),
    ('Huisstijl of menuscherm Mislukt', 'De reden staat in de reactie. Kies opnieuw Haal opnieuw op of Genereer nu.'),
    ('Oplevermail Mislukt', 'De reden staat in de reactie. Los het op en kies opnieuw Verstuur nu.'),
    ('Een mail bekijken zonder echte aanvraag', 'GitHub → Actions → Testmail versturen: kies de mail en vul je adres in.'),
    ('Er komen geen mails meer', 'Waarschijnlijk is het wachtwoord van de mailkoppeling verlopen. De stappen staan in de README van de repo, onder Meldingen per mail.'),
    ('Een knop doet niets', 'Kijk in de README onder Asana koppelen, of vraag Abel.'),
]))
B.append(p('**Twijfel je?** De volledige technische uitleg staat in de README van de repo **Marketing-NBC/designaanvraag**.', '<w:spacing w:before="240"/>'))

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
core = re.sub(r'<dc:title>.*?</dc:title>', f'<dc:title>{NAAM}</dc:title>', core)
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
