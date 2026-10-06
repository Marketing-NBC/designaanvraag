-- Voor welke locatie de aanvraag is: NBC of Green Village.
--
-- Standaard 'nbc', en dat geldt ook voor alles wat er al staat: tot vandaag was het
-- formulier er alleen voor NBC, dus dat is geen aanname maar wat er is gebeurd.
alter table aanvragen
  add column if not exists locatie text not null default 'nbc'
    check (locatie in ('nbc', 'green_village'));

comment on column aanvragen.locatie is
  'NBC of Green Village. Bepaalt in het formulier welke aanvraagtypes er te kiezen zijn.';
