-- De website is niet meer verplicht: niet elk bedrijf of event heeft er een. Zonder website valt er
-- geen huisstijl op te halen, en dat is geen mislukking maar een bewuste overslag. Vandaar een eigen
-- status, zodat het succes-scherm en de cijfers dat onderscheid kunnen maken.

alter table public.aanvragen drop constraint if exists aanvragen_brand_status_check;

alter table public.aanvragen
  add constraint aanvragen_brand_status_check
  check (brand_status in ('pending', 'running', 'done', 'failed', 'overgeslagen'));

comment on column public.aanvragen.brand_status is
  'pending, running, done, failed, of overgeslagen wanneer er geen website is opgegeven.';
