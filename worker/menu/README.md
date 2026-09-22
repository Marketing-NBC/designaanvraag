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

## De drie onderdelen

| Bestand | Wat het doet |
|---|---|
| `basis-extract.py` | Draait eenmalig. Bevriest elk basisontwerp uit het `.ai`-bestand tot een achtergrond (PNG) en een geometriebestand (JSON). |
| `template.html` | De opmaak-engine. Vult een bevroren basisontwerp met de gerechten van een evenement. |
| `controle.mjs` | Legt het resultaat pixel voor pixel naast de pagina uit het `.ai`-bestand. |

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
  "titel": "Diner",
  "merk": {
    "logo": "data:image/png;base64,...",
    "logoAchtergrond": "#ffffff",
    "accent": "#7b2d8e",
    "blobBoven": "#7b2d8e",
    "blobOnder": "#00a3e0"
  },
  "secties": [
    { "kop": "Op tafel", "gerechten": [
      { "naam": "Zuurdesembrood", "ingredienten": ["roomboter", "fleur de sel"] }
    ]}
  ]
}
```

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
  hoort 0,000% te zijn en is dat op dit moment voor alle acht de pakketten.
- **snitverschil** — dezelfde letter op dezelfde plek, maar iets dunner of dikker
  gezet. Zie *Openstaand* hieronder.
- **vlakwerk** — de randen van de blobs, op sub-pixelniveau.
- **via invoerformaat** — hetzelfde ontwerp, maar heen en weer door het
  invoerformaat. Wie het sjabloon ongewijzigd terugstuurt, hoort exact het
  basisontwerp te krijgen. Ook 0,000%.

## Hoe de opmaak werkt

Zolang de tekst dezelfde is als in het basisontwerp, worden de regelval én de
onderlinge afstanden **letterlijk** overgenomen — inclusief de handmatige
correcties die de ontwerper heeft gemaakt. Het resultaat is dan per definitie
identiek.

Wijkt de tekst af (de opdrachtgever vervangt een gerecht), dan breekt de engine
die ene alinea opnieuw af binnen het kader van de kolom, en schuift de rest van
de kolom mee volgens het vaste ritme van dat pakket. De rest van het scherm
blijft staan waar het stond.

### Tekst mag nooit over een blob vallen

Dat is een harde regel, geen streven. De engine leest het silhouet van de blobs
uit de achtergrond en controleert elke getekende regel daartegen. Botst er iets,
dan komt dat als melding terug — de engine gaat *niet* stilletjes de blob
opzijschuiven of de tekst verkleinen, want dan wijkt het scherm af van het
basisontwerp zonder dat iemand het merkt.

```
botsingen: {"tekst":"zongedroogde tomaat 16 | ...","x0":261,"x1":1135,"baseline":1547}
```

Zo'n melding betekent meestal dat het verkeerde pakket is gekozen: voor veel
gerechten is er een ruimer basisontwerp (de `-standaard`-varianten hebben meer
kolommen en minder blobs dan de `-basic`-varianten).

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

Pagina 9 is een exacte kopie van pagina 8 en is overgeslagen.

De namen zijn een aanname op basis van hoe de ontwerpen zich tot elkaar
verhouden; pas ze aan in `PAKKETTEN` in `basis-extract.py` als ze bij NBC anders
heten.

## Openstaand

**Het font `AreaNormal-Thin` ontbreekt in de repo.** De basisontwerpen zetten de
ingrediënten in Thin; de repo heeft alleen `AreaNormal-Hairline.otf`, een
lichtere snit. De engine valt daarop terug en meldt dat bij elke render. De
breedtes schelen minder dan 1%, dus de regelval blijft gelijk en alles staat op
de juiste plek — de tekst oogt alleen 0,5 tot 2,5% lichter dan in het `.ai`.
Zet `AreaNormal-Thin.otf` in `web/src/assets/fonts/` en het verschil is weg;
`render.mjs` pakt hem dan vanzelf op.

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

## Als het `.ai`-bestand verandert

Vervang `basis/bron/Flexibele-template-designs.ai`, draai `basis-extract.py`
opnieuw en daarna `controle.mjs`. Staat "verplaatst" niet op 0,000%, dan is er
iets in het ontwerp veranderd dat de extractie nog niet begrijpt.
