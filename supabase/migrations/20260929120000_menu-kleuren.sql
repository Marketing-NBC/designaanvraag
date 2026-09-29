-- Menuschermen: blobs in de kleuren van de opdrachtgever.
--
-- De blobs zijn standaard oranje-naar-teal, de NBC-huisstijl. Ongeveer een op de vijf
-- opdrachtgevers wil ze in zijn eigen kleuren. Welke van de twee het wordt kiest Marketing in
-- Asana, met het veld "Menuscherm": "Genereer nu" of "Genereer nu (kleuren opdrachtgever)".
--
-- De wens staat hier en niet in de tekst waarmee de Routine wordt afgevuurd: die tekst komt bij de
-- Routine binnen als onbetrouwbare invoer, en het draaiboek gebruikt daar bewust alleen het
-- aanvraag_id uit. Een keuze die het resultaat bepaalt hoort in de database, waar hij bewaard blijft
-- en waar een tweede ronde hem terugvindt.

alter table public.aanvragen
  add column if not exists menu_kleuren text not null default 'nbc'
    check (menu_kleuren in ('nbc', 'opdrachtgever'));

comment on column public.aanvragen.menu_kleuren is
  'Welke kleuren de blobs op het menuscherm krijgen: nbc (de huisstijl) of opdrachtgever '
  '(uit brand_result). Gezet vanuit het veld "Menuscherm" in Asana.';
