-- Aanvullingen op een bestaande aanvraag: extra wensen, aanvullende informatie of feedback op het
-- concept. Ze belanden als comment onder de Asana-taak die er al is, in plaats van als tweede taak
-- voor hetzelfde event. De rij blijft hier staan zodat later te zien is hoe vaak er wordt nagestuurd
-- en op welke aanvragen.

create table if not exists public.aanvullingen (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Verdwijnt de aanvraag, dan hebben de aanvullingen erop geen betekenis meer.
  aanvraag_id uuid not null references public.aanvragen (id) on delete cascade,
  -- Zelfde rol als bij aanvragen: een dubbelklik of retry levert dezelfde aanvulling op.
  client_request_id uuid not null unique,
  naam text not null,
  toelichting text not null,
  -- Wat de collega aanvinkte. Of het ook echt nieuw was voor de taak staat in `bijgewerkt`.
  extra_types text[] not null default '{}',
  anders_tekst text not null default '',
  nieuwe_event_datum date,
  nieuwe_deadline date,
  schijf_locatie text not null default '',
  link text not null default '',
  -- Velden die daadwerkelijk in Asana zijn aangepast; leeg = alleen een reactie geplaatst.
  bijgewerkt text[] not null default '{}',
  -- Wat Asana weigerde. De aanvulling is dan wel bewaard, net als bij aanvragen.
  asana_error text,
  ip_hash text
);

comment on table public.aanvullingen is
  'Naleveringen op een aanvraag: komen als comment onder de bestaande Asana-taak.';

create index if not exists aanvullingen_aanvraag_idx on public.aanvullingen (aanvraag_id, created_at desc);

-- Het zoekscherm doet `event ilike '%...%'` op de aanvragen van de afgelopen maanden. Dat is een
-- scan, maar bij een paar honderd rijen per jaar is dat verwaarloosbaar. Bewust geen trigram-index:
-- die vraagt de extensie pg_trgm, en een extensie die niet aangemaakt mag worden laat de hele
-- migratie stranden. Loopt het ooit vol, dan is dat een aparte migratie waard.

-- Zelfde regime als aanvragen: RLS aan zonder policies, dus anon en authenticated kunnen niets.
-- Alleen de edge functions (secret key) komen erbij.
alter table public.aanvullingen enable row level security;
revoke all on public.aanvullingen from anon, authenticated;
grant select, insert, update, delete on public.aanvullingen to service_role;
