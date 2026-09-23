-- Menuschermen: de opmaak van een menuscherm draait in de worker, niet in de browser.
--
-- De collega die de aanvraag doet ziet daar niets van: hij levert alleen het pakket en de gerechten
-- aan. De worker rendert het scherm, hangt het aan de Asana-taak en zet daar ook zijn bevindingen
-- neer (tekst die over een blob zou vallen, een gerecht dat anders afbreekt dan in het
-- basisontwerp). Marketing leest dat in Asana; het formulier blijft schoon.
--
-- De velden volgen bewust dezelfde vorm als brand_*: status, resultaat, fout en een eigen
-- tijdstempel. Wie het ene begrijpt, begrijpt het andere.

alter table public.aanvragen
  add column if not exists menu_status     text not null default 'pending'
    check (menu_status in ('pending', 'running', 'done', 'failed')),
  add column if not exists menu_inhoud     jsonb,
  add column if not exists menu_result     jsonb,
  add column if not exists menu_error      text,
  add column if not exists menu_updated_at timestamptz;

comment on column public.aanvragen.menu_inhoud is
  'Het pakket en de gerechten voor het menuscherm: { pakket, titel, merk, secties }. '
  'Zie worker/menu/README.md voor de vorm.';
comment on column public.aanvragen.menu_result is
  'Wat de render opleverde: bestandsnaam, opslagpad, Asana-gid en de meldingen van de opmaak-engine.';

-- Alleen aanvragen die nog wachten of draaien zijn interessant om op te halen; de rest is klaar.
create index if not exists aanvragen_menu_status_idx
  on public.aanvragen (menu_status)
  where menu_status in ('pending', 'running');

-- Eigen bucket, niet brand-assets erbij: een menuscherm is geen huisstijl-materiaal en heeft een
-- eigen bewaartermijn en eigen limieten. `do update` zodat de limieten opnieuw af te dwingen zijn
-- als iemand ze in het dashboard heeft aangepast.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menuschermen',
  'menuschermen',
  false,
  20971520, -- 20 MB; een scherm van 3840x2160 is in de praktijk minder dan 1 MB
  array['image/png', 'application/json']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- De culinaire invulling zoals de collega hem in het formulier plakt: een kopje per gang met
-- daaronder de gerechten. De worker leest die tekst uit (worker/menu/menu-tekst.mjs), zoekt het
-- bijpassende basisontwerp erbij en zet het resultaat in menu_inhoud. Staat menu_inhoud al
-- ingevuld, dan gaat die voor: dat is een bewuste correctie met de hand.
alter table public.aanvragen
  add column if not exists menu_tekst text not null default '';

comment on column public.aanvragen.menu_tekst is
  'De menu-invulling zoals aangeleverd: kopje per gang, gerechten met een bolletje, '
  'ingredienten achter een |.';
