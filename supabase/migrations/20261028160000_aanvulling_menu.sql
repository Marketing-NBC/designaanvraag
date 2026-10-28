-- Een aanvulling kan het menu aanpassen ("Menu aanpassen" in het formulier). Het nieuwe menu
-- vervangt dat van de aanvraag, zodat een volgend menuscherm het gebruikt; hier staat wat er bij
-- deze aanvulling is ingestuurd, zodat later terug te zien is wanneer het menu veranderde.
alter table public.aanvullingen
  add column if not exists menu_inhoud jsonb,
  add column if not exists menu_tekst text not null default '';

comment on column public.aanvullingen.menu_inhoud is
  'Het aangepaste menu als structuur; leeg als het menu bij deze aanvulling niet veranderde.';
