-- Spoedaanvragen: minder dan 10 werkdagen tussen de aanvraag en het event.
-- submit-aanvraag berekent dit bij het indienen en past het daarna nooit meer aan, zodat de
-- registratie klopt ook als Marketing de eventdatum later verschuift. Daarom geen gegenereerde
-- kolom: die zou meebewegen, en `at time zone` is bovendien niet IMMUTABLE.

alter table public.aanvragen
  add column if not exists spoed boolean not null default false,
  add column if not exists werkdagen_tot_event integer;

comment on column public.aanvragen.spoed is 'Minder dan 10 werkdagen tussen de aanvraag en het event, bepaald bij het indienen.';
comment on column public.aanvragen.werkdagen_tot_event is 'Werkdagen (ma-vr) tussen de aanvraagdag en de eventdatum, bepaald bij het indienen.';

create index if not exists aanvragen_spoed_idx on public.aanvragen (created_at desc) where spoed;
