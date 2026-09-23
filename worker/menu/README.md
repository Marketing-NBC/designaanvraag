# Menuschermen

Automatisch opgemaakte menuschermen (3840×2160, 4K) voor narrowcasting, op basis
van de vaste pakketten van NBC.

## Het uitgangspunt

Elk pakket heeft één basisontwerp, gemaakt in Illustrator. **Dat basisontwerp is
de norm.** De opmaak-engine leidt er niets meer uit af en rekent niets opnieuw
uit: hij zet elk woord op de baseline die in het Illustrator-bestand staat.

Dat is het verschil met de vorige aanpak, die het ontwerp bij elke run opnieuw
opmat en er een systeem uit probeerde af te leiden (kolommen via clustering, een
schaalfactor, gekalibreerde correcties, een blob die opzij schoof om botsing te
vermijden). Elk van die stappen was een benadering, en benaderingen stapelen op.
Het resultaat leek op het ontwerp, maar was het nooit.

Nu wordt het ontwerp één keer bevroren en daarna alleen nog gevuld.

## De onderdelen

| Bestand | Wat het doet |
|---|---|
| `basis-extract.py` | Draait eenmalig. Bevriest elk basisontwerp uit het `.ai`-bestand tot een achtergrond (PNG) en een geometriebestand (JSON). |
| `template.html` | De opmaak-engine. Vult een bevroren basisontwerp met de gerechten van een evenement. |
| `render.mjs` | Roept de engine aan en levert de PNG plus de meldingen op. |
| `controle.mjs` | Legt het resultaat pixel voor pixel naast de pagina uit het `.ai`-bestand. Ontwikkelgereedschap. |
| `../menu-publiceer.mjs` | De productieweg: rendert, hangt het scherm aan de Asana-taak en zet de meldingen daar als comment bij. |

## Hoe het in productie loopt

De collega die de aanvraag indient ziet hier niets van. Kiest hij een menukaart
of een menuscherm, dan komt er één extra stap in het formulier: *"Wat is de
culinaire invulling?"*. Daar plakt hij het menu zoals hij het van de
opdrachtgever kreeg. Verder niets — geen pakketkeuze, geen opmaak. De rest draait
in de worker, en alles wat daaruit komt landt in Asana, waar Marketing toch al
werkt.

```
formulier → aanvragen.menu_tekst → worker/menu-publiceer.mjs → Asana-taak
                                    ├─ leest de invulling                ├─ bijlage: menuscherm-<pakket>.png
                                    └─ zoekt het pakket erbij            └─ comment: de meldingen
```

```
node worker/menu-publiceer.mjs --aanvraag-id <uuid>
node worker/menu-publiceer.mjs --tekst menu.txt --dry-run     # niets naar Asana of Supabase
node worker/menu-publiceer.mjs --data menu.json --dry-run     # met een uitgewerkte inhoud
```

### De invulling zoals hij binnenkomt

```
Invulling menu:
Op tafel

• Bruschetta-spiezen met seasonal dips

Voorgerecht

• Gerookte hoenderfilet | gel van basilicum en appel | gepofte boekweit
```

Een regel met een bolletje is een gerecht; alles vóór de eerste `|` is de naam,
daarachter staan de ingrediënten. Elke andere regel met tekst is een kopje. Lege
regels en een inleiding als "Invulling menu:" doen niet mee.

Een gerecht met onderdelen (zoals de Tartelettes) schrijf je met een streepje
eronder, of met een bolletje dat inspringt:

```
• Tartelettes
  - Rundertartaar | umamicrème | kwartelei
  - Tallegio (vega) | romige tallegio | kruidencrunch
```

**Het pakket hoeft er niet bij.** De kopjes verraden welk basisontwerp het is:
Op tafel / Voorgerecht / Tussengerecht / Hoofdgerecht / Nagerecht is een
viergangen diner, zonder Tussengerecht een driegangen. Past het bij geen enkel
ontwerp, dan stopt de worker en zegt hij dat in Asana. Welk ontwerp is gekozen
staat altijd bovenaan de comment, want daar hangt de rest van aan.

Staat `menu_inhoud` al ingevuld, dan gaat die voor op de tekst: dat is een
bewuste correctie met de hand.

De comment noemt per punt wat er aan de hand is, op volgorde van ernst: tekst die
een blob raakt, tekst die buiten het scherm valt, een opbouw die afwijkt van het
basisontwerp, een opsomming die van vorm wisselt, en tot slot een gerecht dat
anders afbreekt. Is er niets aan de hand, dan staat er één regel dat het scherm
volgens het basisontwerp is opgemaakt.

**Een mislukking blijft nooit stil.** Lukt de opmaak niet — onbekend pakket, geen
inhoud, een fout in de engine, of tekst die over een vast onderdeel loopt — dan
komt er een comment in Asana met de reden, gaat `menu_status` op `failed` en
stopt het script met een foutcode. De statusvelden (`menu_status`, `menu_tekst`,
`menu_inhoud`, `menu_result`, `menu_error`) volgen dezelfde vorm als de
`brand_*`-velden; zie `supabase/migrations/20260922140000_menuschermen.sql`.

### 1. Bevriezen

```
python3 worker/menu/basis-extract.py
```

Leest `basis/bron/Flexibele-template-designs.ai` en schrijft per pakket:

- `basis/<pakket>.png` — de achtergrond op 3840×2160. Dit zijn de blobs zoals ze
  in het `.ai` staan, gerenderd op ware grootte. Ze zijn dus **niet nagebouwd**
  als SVG-pad; dat kan per definitie niet exact.
- `basis/<pakket>.json` — titel, logobalk, voetregel, kolommen, en per alinea
  elke regel met zijn baseline, font, corps en kleur.
- `basis/referentie/<pakket>.png` — de volledige pagina uit het `.ai`. Hiertegen
  vergelijkt `controle.mjs`.

De rode logobalk en het gouden bestek-icoon zitten bewust **niet** in de
achtergrond: die tekent de engine zelf, zodat ze het logo en de kleuren van de
opdrachtgever kunnen aannemen.

### 2. Renderen

```
node worker/menu/render.mjs --pakketten                        # welke pakketten er zijn
node worker/menu/render.mjs --pakket diner-4gangen --sjabloon  # het invoerformaat
node worker/menu/render.mjs --data menu.json --out scherm.png  # renderen
```

Invoerformaat:

```json
{
  "pakket": "diner-4gangen",
  "titel": "Dinner",
  "merk": {
    "logo": "data:image/png;base64,...",
    "logoAchtergrond": "#ffffff",
    "accent": "#7b2d8e",
    "blobBoven": "#7b2d8e",
    "blobOnder": "#00a3e0"
  },
  "secties": [
    { "kop": "Op tafel", "gerechten": [
      { "naam": "Zuurdesembrood", "ingredienten": ["roomboter", "fleur de sel"] },
      { "naam": "Tartelettes", "onderdelen": [
        { "naam": "Rundertartaar", "toelichting": ["umamicrème", "kwartelei"] }
      ]}
    ]}
  ]
}
```

Een gerecht heeft óf `ingredienten` (een rij achter elkaar, gescheiden door `|`)
óf `onderdelen` (een opsomming met bullets); zie *Opsommingen* hieronder.

Alles onder `merk` is optioneel. Zonder `merk` krijg je de NBC-huisstijl met de
rode plaatshouder voor het logo. `blobBoven`/`blobOnder` zijn voor opdrachtgevers
die de blobs willen laten meekleuren; laat je ze weg, dan blijven ze NBC-oranje
en -teal.

Zonder `secties` rendert de engine het basisontwerp zelf. Handig om te zien wat
een pakket is.

### 3. Controleren

```
node worker/menu/controle.mjs
```

Rendert elk pakket en vergelijkt het met de pagina uit het `.ai`. De uitslag
splitst het verschil op, want niet elk verschil betekent hetzelfde:

- **verplaatst** — tekst staat op een andere plek dan in het basisontwerp. Dit
  hoort 0,000% te zijn en is dat voor alle acht de pakketten.
- **snit** — dezelfde letter op dezelfde plek, maar net anders langs de randen.
  Dit is antialiasing; zie *Fonts* hieronder.
- **vlakwerk** — de randen van de blobs, op sub-pixelniveau.
- **via invoer** — hetzelfde ontwerp, maar heen en weer door het invoerformaat.
  Wie het sjabloon ongewijzigd terugstuurt, hoort exact het basisontwerp te
  krijgen. Ook 0,000%.
- **bij herberekening** — hetzelfde ontwerp, maar met de regelval opnieuw
  uitgerekend in plaats van overgenomen. Dit is wat er gebeurt zodra een gerecht
  wijzigt. Zo zie je of de kolombreedtes kloppen voor het font dat wij zetten.
  Zes van de acht staan op 0,000%, de rest op sub-pixelruis.

## Hoe de opmaak werkt

Voor elke alinea wordt in deze volgorde bepaald hoe hij komt te staan:

1. **Staat deze tekst op deze plek in het basisontwerp?** Dan worden de regelval
   én de onderlinge afstanden letterlijk overgenomen, inclusief de handmatige
   correcties van de ontwerper. Het resultaat is dan per definitie identiek.
2. **Staat dit hele gerecht érgens in een basisontwerp?** Dan wordt het gezet
   zoals dáár — zie de gerechtenbibliotheek hieronder.
3. **Staat deze losse naam of omschrijving érgens in een basisontwerp?** Dan die.
4. **Anders** breekt de engine de alinea zelf af binnen het kader van de kolom.

Verandert er iets, dan schuift de rest van de kolom mee volgens het vaste ritme
van dat pakket. De rest van het scherm blijft staan waar het stond.

### De gerechtenbibliotheek

NBC werkt met een vast repertoire: dezelfde gerechten komen in verschillende
pakketten terug. Staat een gerecht in een ontwerp, dan is dat de manier waarop
het gezet hoort te worden — **inclusief de plek waar de regel afbreekt**. Dat
weegt zwaarder dan onze eigen afbreking, die alleen naar kaderbreedte kijkt.

`basis/gerechten.json` legt dat vast, in twee lagen:

- **`gerechten`** — het hele gerecht, zoals iemand het intypt: naam en
  ingrediënten samen. Dit is de laag die ertoe doet.
- **`alineas`** — losse namen en omschrijvingen. Vangnet voor het geval een
  gerecht maar deels terugkomt; "Burrata" staat in twee pakketten met heel
  andere ingrediënten, en hoort in allebei hetzelfde te breken.

Zo ziet het dessert van pagina 7 er in het viergangen diner precies zo uit als
de ontwerper het op pagina 7 zette:

```
Dessertbuffet met          ← breekt na "met", niet na "Dessertbuffet"
zoete lekkernijen
L'OR Coffee Popping Pearls ← blijft op één regel
```

Het opzoeken is ongevoelig voor zetwerk dat geen inhoud is: hoofdletters, de
soort apostrof (`'` of `’`) en spaties rond een `|` doen niet mee. Wat er
getekend wordt is altijd de tekst zoals hij in het ontwerp staat.

Voor een heel gerecht telt bovendien niet mee wáár de streep staat. Deze twee
zijn hetzelfde gerecht:

```
Dessertbuffet met zoete lekkernijen | L'OR Coffee Popping Pearls
Dessertbuffet | met zoete lekkernijen | L'OR Coffee Popping Pearls
```

De bibliotheek zegt welk deel de naam is, niet degene die het intypt — dus
beide leveren hetzelfde scherm op, tot op de pixel.

### Een gerecht dat anders is opgeschreven

Het repertoire ligt vast, maar de tekst komt binnen zoals de traiteur hem
opschrijft: andere bewoording, andere volgorde, soms een tikfout. `gerecht-match.mjs`
vindt het gerecht dan alsnog.

**Niet op gelijkenis.** Dat is geprobeerd en het is gevaarlijk. "tasteful gift
zalmtartaar | mierikswortel | affilla cress" lijkt voor 90% op de tonijnversie uit
het ontwerp — met een marge van 0,57 tot het eerstvolgende gerecht, dus geen enkele
drempel houdt dat tegen. Er zou tonijn op het scherm komen waar zalm besteld is, en
juist het wisselen van een product is bij NBC de normale gang van zaken.

**Wel op dekking:** elk woord uit het basisontwerp moet ook in de aangeleverde tekst
staan. Een tikfout mag (één letter erbij, eraf of anders, alleen in woorden vanaf
vijf letters — "ui" en "ei" zijn geen verschrijving van elkaar), extra woorden mogen
tot 40% van de lengte, een andere volgorde mag. Ontbreekt er een woord, dan is het
een ander gerecht en houden we onze handen ervan af.

| Aangeleverd | Uitkomst |
|---|---|
| `dessertbuffet – verschillende zoete lekkernijen met L'OR coffee popping pearls` | ✔ herkend |
| `dessertbuffet met zoete lekkernije \| L'OR coffee popping pearls` | ✔ herkend (tikfout) |
| `tasteful gift zalmtartaar \| mierikswortel \| affilla cress` | ✘ ander gerecht |
| `pompoenravioli \| gedroogde spaanse ham \| saliebotersaus` | ✘ ander gerecht |
| `burrata \| tomatenmix \| truffelolie` | ✘ ander gerecht |

Passen er twee gerechten even goed, dan raadt hij niet: onze eigen afbreking is beter
dan het verkeerde gerecht. En wordt een gerecht wél herkend maar niet letterlijk, dan
staat er iets anders op het scherm dan er is ingetypt — dat komt als melding in de
Asana-comment te staan, zodat Marketing het kan nakijken.

`gerecht-match.mjs` draait op twee plekken: in de tests hier, en in de browser waar de
opmaak-engine staat. `render.mjs` zet het bestand als script in het sjabloon, zodat de
regels op één plek staan en niet uit elkaar kunnen lopen.

Bij het opnieuw uitrekenen van de regelval (`bij herberekening` in de controle)
wordt de bibliotheek bewust overgeslagen: die stand toetst juist of onze eigen
afbreking op dezelfde regels uitkomt.

### Gedeelde tekstkaders

Pagina 7 en 8 zijn dezelfde layout — kolommen op 261, 1352 en 2278. Toch leidde
de extractie er eerst twee verschillende kaderbreedtes uit af, omdat elke pagina
alleen zijn eigen inhoud te zien kreeg. Kolom 3 werd daardoor 30 eenheden te smal
en brak een omschrijving af die in het ontwerp op één regel past.

Pagina's met dezelfde kolomindeling delen nu hun kaders: de ondergrens is de
langste regel van alle pagina's samen, de bovengrens de scherpste afbreking.
Sluiten die elkaar uit, dan zijn het toch niet dezelfde kaders en meldt de
extractie dat; elke pagina houdt dan zijn eigen waarde.

### Tekst mag nooit over iets anders heen

Dat is een harde regel, geen streven. Het gaat om de blobs, de logobalk en de
dieetwens-regel onderaan. De engine leest het silhouet van de blobs uit de
achtergrond en kent de vaste vakken van de logobalk en de voetregel; elke
getekende regel wordt daartegen gehouden.

Gebeurt het toch, dan **is het scherm niet af en gaat het niet als resultaat de
deur uit**. `menu-publiceer.mjs` zet `menu_status` op `failed`, hangt het beeld
onder de naam `NIET-BRUIKBAAR-menuscherm-<pakket>.png` bij de taak — je moet
kunnen zien waar het misgaat — en zet er een comment bij die geen twijfel laat:

> **Dit menuscherm kan zo niet gebruikt worden.** De tekst loopt over vaste
> onderdelen van het ontwerp heen, en dat mag nooit.
> - **Hoofdgerecht – Langzaam gegaarde kalfsrollade:** "parmezaanse roomsaus |
>   citroen | groene" loopt over de dieetwens-regel.

De melding noemt de gang én het gerecht, want daar moet iemand iets aan doen.
De engine schuift de blob *niet* opzij en verkleint de tekst *niet*: dan zou het
scherm van het basisontwerp afwijken zonder dat iemand het merkt.

De oplossing is redactioneel: kort het gerecht in. Het basisontwerp laat zien
hoe — een lang gerecht wordt een korte naam met de rest erachter als
omschrijving:

```
• Dessertbuffet met zoete lekkernijen | L'OR Coffee Popping Pearls
```

in plaats van alles in de naam. Soms is ook het verkeerde pakket gekozen: de
`-standaard`-varianten hebben meer kolommen en minder blobs dan de
`-basic`-varianten.

## De pakketten

| Pakket | Pagina in het `.ai` | Kolommen | Secties | Gerechten |
|---|---|---|---|---|
| `lunch-standaard` | 1 | 3 | 6 | 18 |
| `lunch-basic` | 2 | 2 | 2 | 7 |
| `lunch-vega-standaard` | 3 | 3 | 6 | 16 |
| `lunch-vega-basic` | 4 | 2 | 2 | 7 |
| `grab-and-go` | 5 | 3 | 5 | 15 |
| `buffet` | 6 | 3 | 3 | 11 |
| `diner-3gangen` | 7 | 3 | 4 | 5 |
| `diner-4gangen` | 8 | 3 | 5 | 6 |

Pagina 9 is een exacte kopie van pagina 8 en is overgeslagen. De namen staan op
één plek, in `PAKKETTEN` in `basis-extract.py`.

### Correcties op het Illustrator-bestand

Het basisontwerp is de norm, maar als er een fout in staat kunnen we er bewust
van afwijken. Dat gaat via `CORRECTIES` in `basis-extract.py`, zodat het op één
plek zichtbaar is en blijft staan als het `.ai` opnieuw geëxporteerd wordt.

Er zijn twee soorten: `CORRECTIES` voor iets dat per pakket anders moet (nu leeg
— de schermtitel en de spelling van de voetregel zijn in V2 rechtgezet), en
`WOORDCORRECTIES` voor een woord dat in het ontwerp verkeerd gespeld staat:

| In het `.ai` | Wat wij zetten | Waar |
|---|---|---|
| lekkernije | **lekkernijen** | "Dessertbuffet met zoete lekkernije", pagina 7 |

Zo'n woordcorrectie is niet alleen cosmetisch: zonder die stap is het gerecht
niet terug te vinden in de gerechtenbibliotheek, want wie het goed spelt vindt de
verkeerd gespelde versie niet.

De extractie
bewaart bij een correctie de oorspronkelijke tekst als `titel.bronTekst`; daar
vergelijkt `controle.mjs` dan mee, anders zou hij onze eigen correctie als fout
meten. Wordt een correctie overbodig, dan meldt de extractie dat hij weg kan.

## Fonts

De basisontwerpen gebruiken sinds V2 dezelfde snitten als wij zetten:
`Pockota-Medium` voor titels en kopjes, `AreaNormal-ExtraBold` voor gerechten,
`AreaNormal-Hairline` voor ingrediënten en `AreaNormal-HairlineItalic` voor de
toelichting in een opsomming. De kolom **snit** in de controle is daarmee nog
maar antialiasing langs de letterranden (0,1 tot 0,7% verschil in inkt), geen
verschil in gewicht meer.

`VERVANGINGEN` in `render.mjs` staat er nog voor één geval: een ouder
`.ai`-bestand zet de ingrediënten in `AreaNormal-Thin`. Die naam wordt dan naar
Hairline gebracht in plaats van de render te laten falen.

Kent de renderer een font niet, dan **faalt de render** met een duidelijke fout.
Hij valt nooit stilzwijgend op iets anders terug, want dat levert andere breedtes
en dus een andere regelval op dan het basisontwerp.

Om diezelfde reden laadt de engine elk font expliciet vóórdat er iets gemeten
wordt. `document.fonts.ready` is daarvoor niet genoeg: een `@font-face` die nog
nergens in de DOM gebruikt is, wordt niet geladen, en dan meet canvas
`measureText` stilletjes in een vervangend font — in de praktijk 20% te smal.
Dat brak zowel de regelval als de blob-controle. De test *"de engine meet in het
echte font, niet in een vervanger"* bewaakt dit.

## Openstaand

**Onregelmatigheden in de basisontwerpen.** De ontwerpen zijn met de hand gezet
en zijn onderling niet consistent. De extractie rapporteert ze per pakket in
`afwijkingen` (regelafstanden die van het eigen ritme afwijken) en `zetfouten`
(losse scheidingstekens, ontbrekende spaties). Ze worden bij het renderen
letterlijk overgenomen — het basisontwerp is de norm — maar ze staan in de JSON
zodat ze in het `.ai` opgeruimd kunnen worden. De grootste:

- **Buffet** zet kolom 2 op een andere typografische schaal (79,2/61,6/41,8) dan
  kolom 1 en 3 (72/56/38), en gebruikt daar drie verschillende afstanden tussen
  gerechten (124,98 / 128,93 / 142,11).
- **Grab & Go** gebruikt 117,20 tussen gerechten in kolom 1–2 maar 125,99 in
  kolom 3.
- Het bestek-icoon in de voetregel heeft drie formaten (124,58 / 131,96 /
  204,21) die niet meeschalen met de tekst ernaast.

## Opsommingen met bullets

Bij "Tartelettes" in Grab & Go staat geen rij ingrediënten maar een opsomming:
per onderdeel een bullet met de naam, en daaronder een cursieve toelichting.

Dat is geen uitzondering in de code maar een **opmaakvorm die overal kan
opduiken**, dus hij ligt vast als structuur:

```json
{
  "naam": "Tartelettes",
  "onderdelen": [
    { "naam": "Rundertartaar", "toelichting": ["umamicrème", "kwartelei"] },
    { "naam": "Tallegio (vega)", "toelichting": ["romige tallegio (kaasvulling)", "kruidencrunch"] }
  ]
}
```

Daardoor kun je er een onderdeel bij zetten (een derde smaak) en kun je het
gerecht naar een **ander pakket** verplaatsen — ook naar een pakket waar het
`.ai`-bestand zelf geen opsomming heeft. De maten van een opsomming (inspringing,
corps van de toelichting, de sprong naar de volgende bullet) zijn één keer
afgeleid uit Grab & Go en als verhouding vastgelegd. Elk pakket krijgt ze
meegeschaald op zijn eigen corps, in `opsommingStijl`. Dat mag, omdat de twee
typografische schalen in de ontwerpen precies een factor 1,1 schelen.

Wissel je van vorm — bullets waar het ontwerp ingrediënten had of andersom — dan
komt dat als melding terug, want het scherm ziet er dan anders uit dan het
basisontwerp.

## Als het `.ai`-bestand verandert

Vervang `basis/bron/Flexibele-template-designs.ai`, draai `basis-extract.py`
opnieuw en daarna `controle.mjs`. Staat "verplaatst" niet op 0,000%, dan is er
iets in het ontwerp veranderd dat de extractie nog niet begrijpt.
