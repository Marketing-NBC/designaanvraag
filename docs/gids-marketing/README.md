# Gids voor Marketing

**[Designaanvragen in Asana - Handleiding voor Marketing.pdf](Designaanvragen%20in%20Asana%20-%20Handleiding%20voor%20Marketing.pdf)**:
hoe een designaanvraag in Asana loopt, van binnenkomst tot oplevering en feedback. In de opmaak van de
[gids voor projecten](../gids-projecten/), met een voorbeeldaanvraag voor het verzonnen event
Zorgcongres 2026.

Het Word-bestand ernaast is de bron. Kleine tekstwijzigingen kun je daar direct in maken en opnieuw als
PDF opslaan. Opnieuw bouwen:

```bash
python3 docs/gids-marketing/bron/bouw.py      # Word en PDF opnieuw (LibreOffice nodig)
```

- **De tekst** staat in `bouw.py`. Draai je dat, dan wordt een tekstwijziging die je alleen in Word hebt
  gemaakt overschreven. Zet hem dus ook in `bouw.py`.
- **De beelden** staan klaar in `bron/kader/`. Daar zijn echte namen al onleesbaar gemaakt.
- **Nieuwe Asana-screenshots?** Zet ze als `a01.png`… in `bron/asana-origineel/` (staat niet in git,
  want daar staan echte namen op), pas de uitsneden, onleesbare stukken en kaders aan in `asana.py`
  en draai `python3 docs/gids-marketing/bron/asana.py`.
- **De mails** (nieuwe aanvraag, aanvulling, weekoverzicht) maakt `mails.mts` na met de echte opmaak uit
  `shared/`; `node docs/gids-marketing/bron/mails.cjs` maakt er screenshots met kaders van.
