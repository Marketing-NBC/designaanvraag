# Wensen voor de app

Wensen die nog in het formulier moeten komen. Pak ze op bij de volgende ronde aan de app, en haal
ze hier weg als ze gedaan zijn.

## Uit de gecorrigeerde projectengids (manager Marketing, oktober 2026)

De tekst van de [gids voor projecten](gids-projecten/) is door de manager van Marketing herschreven.
Op één punt beschrijft die tekst iets wat het formulier nog anders doet. De gids loopt hier dus al
op vooruit.

### De rode melding bij een krappe datum

**Nu.** Valt de eventdatum of de deadline binnen 3 werkdagen (`KRAP_WERKDAGEN` in `web/src/steps.ts`),
dan zegt de rode melding dat de collega na het versturen *meteen contact moet opnemen* met
Marketing:

- eventdatum (`alarm` bij `event_datum`): "Vul het formulier gewoon in en neem daarna meteen even
  contact op met het marketingteam (…) om te bespreken wat er precies gedaan moet worden."
- deadline (`deadlineAlarm`): "We kunnen dan niet beloven dat het op tijd klaar is. Verstuur je
  aanvraag en neem daarna meteen even contact op met het marketingteam (…)."

**Gewenst.** De collega vult het formulier gewoon verder in; Marketing beoordeelt zelf wat er nog
kan. Zo staat het in de gids:

> Valt de eventdatum of deadline binnen 3 werkdagen? Dan verschijnt er een rode melding. Vul het
> formulier verder in. Het marketingteam beoordeelt vervolgens wat er binnen de korte deadline
> haalbaar is.

**Nog uit te zoeken bij het aanpassen:**

- Het bedankscherm (`web/src/components/Success.tsx`, `contactMail`) zegt bij zo'n krappe aanvraag
  ook "Neem nu even contact op met het marketingteam". Moet dat mee veranderen? De gids zegt nu:
  "Is het erg krap? Dan herinnert het formulier je eraan om contact op te nemen met Marketing."
  Verandert het bedankscherm, pas dan ook die zin aan in `docs/gids-projecten/bron/bouw.py`.
- De gids beschrijft de meldingen nu zonder screenshot. Wil je er na de wijziging een bij (`g04-krap`
  in `docs/gids-projecten/bron/screenshots.cjs`), let dan op: de gids mag hooguit zeven pagina's zijn.
