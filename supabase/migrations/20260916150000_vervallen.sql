-- Verwijdert Marketing een taak in Asana, dan hoort die aanvraag ook uit de applicatie te
-- verdwijnen: niet meer te vinden in het zoekscherm, en er kan geen aanvulling meer op.
--
-- De rij zelf blijft staan. Dat is bewust: het is de enige administratie van wat er is aangevraagd,
-- en de spoedcijfers leunen erop. Alleen is hij vanaf nu vervallen.

alter table public.aanvragen
  add column if not exists vervallen_op timestamptz;

comment on column public.aanvragen.vervallen_op is
  'Gezet toen de Asana-taak werd verwijderd. Vervallen aanvragen zijn niet meer te vinden en kunnen geen aanvulling meer krijgen.';

-- Het zoekscherm filtert hierop, dus houd die zoekopdracht snel.
create index if not exists aanvragen_vervallen_idx on public.aanvragen (created_at desc) where vervallen_op is null;
