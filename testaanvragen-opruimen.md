# Testaanvragen opruimen — inventaris

Vastgelegd op 26-10-2026. Supabase-project `ommujhlzffxalltlgzti` (Designaanvraag).

Deze lijst bestaat omdat de koppeling tussen een aanvraag en haar Asana-taak alleen in de
database staat, in `aanvragen.asana_task_gid`. Gooi je die rijen eerst weg, dan is niet meer
na te gaan welke taken in Asana bij deze tests horen.

## Wat er weg moet

| wat | aantal | hoe |
| --- | --- | --- |
| Asana-taken | 36 | Asana API `DELETE /tasks/{gid}`, of met de hand in Asana |
| `aanvragen` | 36 | SQL; `aanvullingen` en `bijlagen` gaan mee via ON DELETE CASCADE |
| `aanvullingen` | 8 | cascade |
| `bijlagen` | 10 | 9 via cascade, 1 wees (`aanvraag_id` leeg) apart |
| opslag `brand-assets` | 31 bestanden, 10 MB | Storage API, per aanvraag-id-map |
| opslag `menuschermen` | 7 bestanden, 3,2 MB | Storage API |
| opslag `aanvraag-bijlagen` | 1 bestand (`deloitte.svg`) | Storage API |

Alle drie de buckets bevatten uitsluitend mappen die op een aanvraag-id staan, en alle acht
voorkomende id's staan in de lijst hieronder. Er zit dus niets tussen dat moet blijven —
`brand-assets` is geen gedeelde huisstijlbibliotheek maar opgehaald materiaal per aanvraag.

## Volgorde

Asana eerst, database daarna. Verwijderde Asana-taken staan 30 dagen in Verwijderd en zijn
terug te halen; databaserijen zijn direct en definitief weg. Eerst de herstelbare kant.

## De 36 taken

| datum | aanvrager | event | asana gid | link |
| --- | --- | --- | --- | --- |
| 15-09 | Testaanvraag Claude | TEST M4 huisstijl (mag weg) | `1218491086190887` | https://app.asana.com/0/0/1218491086190887 |
| 15-09 | Testaanvraag Claude | TEST huisstijl Rijksmuseum (mag weg) | `1218491444769472` | https://app.asana.com/0/0/1218491444769472 |
| 15-09 | Testaanvraag Claude | TEST zonder website (mag weg) | `1218495563614295` | https://app.asana.com/0/0/1218495563614295 |
| 15-09 | Wendy | Test evenement | `1218510823462307` | https://app.asana.com/0/0/1218510823462307 |
| 16-09 | Wendy | Test evenement | `1218536436737571` | https://app.asana.com/0/0/1218536436737571 |
| 16-09 | Testaanvraag (automatisch) | TEST losse aanvraag | `1218539857375719` | https://app.asana.com/0/0/1218539857375719 |
| 16-09 | Testaanvraag (automatisch) | TEST meerdere designs | `1218539871423839` | https://app.asana.com/0/0/1218539871423839 |
| 16-09 | Testaanvraag (automatisch) | TEST spoedaanvraag | `1218539801323205` | https://app.asana.com/0/0/1218539801323205 |
| 16-09 | Testaanvraag (automatisch) | TEST zonder website | `1218540010808903` | https://app.asana.com/0/0/1218540010808903 |
| 16-09 | Testaanvraag (automatisch) | TEST bijlagen automatische test | `1218540010856185` | https://app.asana.com/0/0/1218540010856185 |
| 16-09 | Testaanvraag (automatisch) | TEST losse aanvraag | `1218550628375670` | https://app.asana.com/0/0/1218550628375670 |
| 16-09 | Testaanvraag (automatisch) | TEST meerdere designs | `1218550670618482` | https://app.asana.com/0/0/1218550670618482 |
| 16-09 | Testaanvraag (automatisch) | TEST spoedaanvraag | `1218550610141675` | https://app.asana.com/0/0/1218550610141675 |
| 16-09 | Testaanvraag (automatisch) | TEST zonder website | `1218550355108368` | https://app.asana.com/0/0/1218550355108368 |
| 16-09 | Testaanvraag (automatisch) | TEST bijlagen automatische test | `1218550672760237` | https://app.asana.com/0/0/1218550672760237 |
| 16-09 | Testaanvraag (automatisch) | TEST losse aanvraag | `1218551842748856` | https://app.asana.com/0/0/1218551842748856 |
| 16-09 | Testaanvraag (automatisch) | TEST meerdere designs | `1218551909487840` | https://app.asana.com/0/0/1218551909487840 |
| 16-09 | Testaanvraag (automatisch) | TEST spoedaanvraag | `1218551844026658` | https://app.asana.com/0/0/1218551844026658 |
| 16-09 | Testaanvraag (automatisch) | TEST zonder website | `1218552175596111` | https://app.asana.com/0/0/1218552175596111 |
| 16-09 | Testaanvraag (automatisch) | TEST bijlagen automatische test | `1218552146705078` | https://app.asana.com/0/0/1218552146705078 |
| 17-09 | Testaanvraag (automatisch) | TEST losse aanvraag | `1218572859832092` | https://app.asana.com/0/0/1218572859832092 |
| 17-09 | Testaanvraag (automatisch) | TEST meerdere designs | `1218572745911064` | https://app.asana.com/0/0/1218572745911064 |
| 17-09 | Testaanvraag (automatisch) | TEST spoedaanvraag | `1218572877162779` | https://app.asana.com/0/0/1218572877162779 |
| 17-09 | Testaanvraag (automatisch) | TEST zonder website | `1218572745685814` | https://app.asana.com/0/0/1218572745685814 |
| 17-09 | Testaanvraag (automatisch) | TEST bijlagen automatische test | `1218572746183567` | https://app.asana.com/0/0/1218572746183567 |
| 22-09 | Wendy | test huisstijl | `1218740342758089` | https://app.asana.com/0/0/1218740342758089 |
| 23-09 | Wendy | TEst menuschermen | `1218777933180326` | https://app.asana.com/0/0/1218777933180326 |
| 23-09 | Wendy | test menuschermen V2 | `1218778804375377` | https://app.asana.com/0/0/1218778804375377 |
| 02-10 | Bo | Test menuschermen V2 | `1219095219930866` | https://app.asana.com/0/0/1219095219930866 |
| 05-10 | Britt | Test menuschermen V4 | `1219149924472231` | https://app.asana.com/0/0/1219149924472231 |
| 05-10 | Daphne | Compaxo - 20 oktober | `1219151138409922` | https://app.asana.com/0/0/1219151138409922 |
| 05-10 | Bo | Test evenement V5 | `1219152192656699` | https://app.asana.com/0/0/1219152192656699 |
| 06-10 | Karen | Test Compaxo 14 okt | `1219209749284524` | https://app.asana.com/0/0/1219209749284524 |
| 06-10 | Daphne | Test evenement v5 | `1219211036231606` | https://app.asana.com/0/0/1219211036231606 |
| 09-10 | Britt | EY -11 december | `1219345581248433` | https://app.asana.com/0/0/1219345581248433 |
| 26-10 | Mara | Test menuscherm Grab & Go | `1219862847317365` | https://app.asana.com/0/0/1219862847317365 |

## Wat ik nodig heb om dit zelf te doen

De databaserijen kan ik al: daarvoor heb ik de Supabase-koppeling in de sessie. Voor de andere
twee kanten ontbreken sleutels in de omgeving:

| variabele | waarvoor | staat al als GitHub-secret |
| --- | --- | --- |
| `ASANA_PAT` | de 36 taken verwijderen | ja |
| `SUPABASE_URL` | opslag bereiken | ja |
| `SUPABASE_SECRET_KEY` | de 39 bestanden verwijderen (heet in Actions `SB_SECRET_KEY`) | ja |

`app.asana.com` is vanuit de sessie bereikbaar, dus het netwerk zit niet in de weg — alleen de
sleutels. Een nieuwe sessie pikt ze op, de lopende niet.

## Verwacht: een deel van de taken is in Asana al weg

`scripts/asana-test.mjs` verwijdert aan het eind van iedere run zijn eigen testtaken, maar laat de
Supabase-rijen bewust staan ("die mag je met de hand weggooien"). De 20 rijen op naam van
*Testaanvraag (automatisch)* verwijzen dus vrijwel zeker naar taken die niet meer bestaan. Een 404
op die gids is het verwachte antwoord, geen fout.

Blijven over als waarschijnlijk nog echt aanwezig in Asana: de 3 van *Testaanvraag Claude* en de
13 op naam van Wendy, Bo, Britt, Daphne, Karen en Mara — samen 16.
