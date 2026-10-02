-- Welk pakket de aanvrager koos.
--
-- De worker leidde het pakket tot nu toe af uit de kopjes van de invulling. Dat is
-- gevaarlijk zodra iemand een gerecht weghaalt: haal een broodje uit de Basic Lunch
-- en de gok komt uit op de vega-versie, waarna er een vega-ontwerp onder een menu
-- met ham komt te staan. Het formulier weet welk pakket is aangeklikt, dus dat
-- hoort het door te geven in plaats van het te laten raden.
alter table public.aanvragen
  add column if not exists menu_pakket text not null default '';

comment on column public.aanvragen.menu_pakket is
  'Het pakket dat de aanvrager in het formulier koos (bestandsnaam van het basisontwerp, '
  'bijvoorbeeld lunch-basic). Leeg bij aanvragen van voor het keuzescherm; dan leidt de '
  'worker het pakket alsnog af uit de kopjes.';
