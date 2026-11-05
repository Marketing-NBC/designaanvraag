# Gids voor projecten

**[Designs aanvragen - Handleiding voor projecten.pdf](Designs%20aanvragen%20-%20Handleiding%20voor%20projecten.pdf)**: de
handleiding van het formulier voor projectleiders. Zeven pagina's, in de opmaak van de drankgids: een
screenshot in een Windows-venster met oranje genummerde kaders, en de uitleg ernaast. Tekst en
indeling zijn van de manager van Marketing (oktober 2026, bijgewerkt in november 2026 met de bevestigingsmail,
akkoord geven, herinneringen, de namenlijst en Engelse menu's); wensen voor de app die daaruit kwamen staan
in [app-wensen.md](../app-wensen.md).

Het Word-bestand ernaast is de bron. Kleine tekstwijzigingen kun je daar direct in maken en opnieuw als
PDF opslaan. Verandert het formulier zelf, maak de screenshots dan opnieuw:

```bash
npm install                                   # één keer
npm run build -w web
(cd web && npx vite preview --host 127.0.0.1 --port 4173 --strictPort &)   # formulier in mock-modus
node docs/gids-projecten/bron/screenshots.cjs # screenshots met kaders  → bron/shots/
python3 docs/gids-projecten/bron/kader.py     # in een Windows-venster  → bron/kader/
python3 docs/gids-projecten/bron/bouw.py      # Word en PDF opnieuw (LibreOffice nodig)
```

- **Welke stappen en kaders** staan in `screenshots.cjs`. Het voorbeeld-event is Zorgcongres 2026, dat
  ook in de mock van het zoekscherm staat; de verzonnen namen uit de mock krijgen een achternaam.
- **De opleveringsmail** in hoofdstuk 4 maakt `mail.mts` met de echte opmaak uit `shared/oplevering.ts`,
  met de knoppen Feedback geven en Akkoord geven; `screenshots.cjs` roept het zelf aan. Alleen dat
  screenshot opnieuw, zonder het formulier: `node docs/gids-projecten/bron/screenshots.cjs mail`, dan `kader.py`.
- **Hooguit zeven pagina's**: dat is de afspraak met Marketing. Hoofdstukken lopen daarom door op dezelfde
  pagina en niet elke vraag heeft een screenshot (`los(...)` in `bouw.py` is uitleg zonder beeld).
- **Het Word-bestand is leidend** sinds de versie van november 2026: die tekst is in Word bijgewerkt en
  staat niet in `bouw.py`. Draai `bouw.py` dus niet meer, want dan gaat die tekst verloren. Een nieuw
  screenshot zet je in Word op de plek van het oude (Afbeelding wijzigen), op dezelfde hoogte.
- **De fonts** (Area Normal, Pockota) moeten op de computer staan, anders kiest LibreOffice een vervanger.
  Ze staan in `web/src/assets/fonts/`.
