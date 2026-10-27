-- Evenement of intern.
--
-- Een interne aanvraag (visitekaartjes, een poster voor de kantine) heeft geen event, geen
-- eventdatum en geen keuze tussen custom en standaard: alleen wat er nodig is en wanneer.
-- Vandaar dat die kolommen leeg mogen blijven. Event blijft een tekst die leeg is, net als
-- website; alleen de datum en de designkeuze worden echt null.
--
-- Standaard 'evenement', en dat klopt ook voor alles wat er al staat: tot vandaag kon je
-- alleen voor een evenement aanvragen.
alter table public.aanvragen
  add column if not exists soort text not null default 'evenement'
    check (soort in ('evenement', 'intern'));

alter table public.aanvragen alter column event_datum drop not null;
alter table public.aanvragen alter column design_modus drop not null;

-- Een evenement zonder datum kan niet; alleen een interne aanvraag mag hem missen.
alter table public.aanvragen
  add constraint aanvragen_event_datum_bij_evenement
    check (soort = 'intern' or event_datum is not null);

comment on column public.aanvragen.soort is
  'evenement of intern. Een interne aanvraag heeft geen event, eventdatum, website of aanvraagtypes.';

-- Interne aanvragen vind je bij een aanvulling terug op je eigen naam.
create index if not exists aanvragen_intern_naam_idx
  on public.aanvragen (lower(naam), created_at desc) where soort = 'intern';
