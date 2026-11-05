# Gids voor Marketing

**[Designaanvragen in Asana - Handleiding voor Marketing.pdf](Designaanvragen%20in%20Asana%20-%20Handleiding%20voor%20Marketing.pdf)**:
hoe de tool werkt, wat Marketing in Asana doet en hoe we te werk gaan: van binnenkomst via oplevering
tot akkoord en feedback. Versie november 2026. In de opmaak van de [gids voor projecten](../gids-projecten/):
voorop één pagina met de afspraken, daarna tien hoofdstukken met screenshots, met een voorbeeldaanvraag
voor het verzonnen event Zorgcongres 2026.

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
- **De mails** (nieuwe aanvraag, aanvulling, weekoverzicht, proefmail, akkoord, herinnering en
  bevestiging) maakt `mails.mts` na met de echte opmaak uit `shared/`; `node docs/gids-marketing/bron/mails.cjs`
  maakt er screenshots met kaders van (`npm install` eerst). Daarna zet `python3 docs/gids-marketing/bron/asana.py`
  ze in `bron/kader/`; zonder `asana-origineel/` doet hij alleen de mails.
- **De Asana-screenshots zijn van oktober 2026.** Daarop staat de kolom Afgerond nog niet; de tekst zegt dat.
  Bij nieuwe screenshots kan die zin uit hoofdstuk 2.
