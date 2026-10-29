# Gids voor projecten

**[Designs aanvragen - Handleiding voor projecten.pdf](Designs%20aanvragen%20-%20Handleiding%20voor%20projecten.pdf)**: de
handleiding van het formulier voor projectleiders. Twaalf pagina's, in de opmaak van de drankgids: een
screenshot in een Windows-venster met oranje genummerde kaders, en de uitleg ernaast. Tekst en
indeling zijn van de manager van Marketing (oktober 2026); wensen voor de app die daaruit kwamen staan
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
- **De opleveringsmail** in hoofdstuk 5 maakt `mail.mts` met de echte opmaak uit `shared/oplevering.ts`;
  `screenshots.cjs` roept het zelf aan.
- **De tekst** staat in `bouw.py`. Draai je dat, dan wordt een tekstwijziging die je alleen in Word hebt
  gemaakt overschreven. Zet hem dus ook in `bouw.py`.
- **De fonts** (Area Normal, Pockota) moeten op de computer staan, anders kiest LibreOffice een vervanger.
  Ze staan in `web/src/assets/fonts/`.
