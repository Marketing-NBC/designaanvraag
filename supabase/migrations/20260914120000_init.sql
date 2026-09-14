-- Designaanvraag: basisschema.
-- Alles is afgeschermd via RLS; de edge function en de worker gebruiken de secret key.

create extension if not exists pgcrypto;

-- ── Aanvragen ────────────────────────────────────────────────────────
create table public.aanvragen (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  client_request_id uuid not null unique,
  naam              text not null,
  event             text not null,
  event_datum       date not null,
  deadline          date not null,
  website           text not null,
  schijf_locatie    text not null default '',
  aanvraag_types    text[] not null,
  anders_tekst      text not null default '',
  design_modus      text not null check (design_modus in ('custom', 'standaard')),
  omschrijving      text not null default '',
  asana_task_gid    text,
  asana_task_url    text,
  asana_error       text,
  brand_status      text not null default 'pending' check (brand_status in ('pending', 'running', 'done', 'failed')),
  brand_result      jsonb,
  brand_error       text,
  brand_session_url text,
  brand_updated_at  timestamptz,
  ip_hash           text
);

comment on table public.aanvragen is 'Designaanvragen van NBC-collega''s. Bron voor de Asana-taak en de huisstijl-extractie.';

create index aanvragen_created_at_idx on public.aanvragen (created_at desc);
create index aanvragen_brand_status_idx on public.aanvragen (brand_status) where brand_status in ('pending', 'running');

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger aanvragen_set_updated_at
  before update on public.aanvragen
  for each row execute function public.set_updated_at();

-- RLS aan zonder policies: anon/authenticated kunnen niets, alleen de secret key (bypass).
alter table public.aanvragen enable row level security;

-- ── Collega's ────────────────────────────────────────────────────────
create table public.collegas (
  id         uuid primary key default gen_random_uuid(),
  naam       text not null unique,
  actief     boolean not null default true,
  volgorde   integer not null default 100,
  created_at timestamptz not null default now()
);

comment on table public.collegas is 'Namen in de keuzelijst van het formulier. Beheer via de Supabase-UI; geen deploy nodig.';

alter table public.collegas enable row level security;

-- Publiek mag alleen actieve namen zien, en alleen de kolommen naam en volgorde.
create policy "collegas: actieve namen publiek leesbaar"
  on public.collegas for select
  to anon, authenticated
  using (actief);

revoke all on public.collegas from anon, authenticated;
grant select (naam, volgorde) on public.collegas to anon, authenticated;

create view public.collegas_public
  with (security_invoker = true) as
  select naam, volgorde
  from public.collegas
  where actief;

grant select on public.collegas_public to anon, authenticated;

-- ── Rate limiting ────────────────────────────────────────────────────
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limits enable row level security;

-- Telt atomisch op binnen het venster (bv. '1 hour', '1 day') en geeft de nieuwe stand terug.
create or replace function public.bump_rate_limit(p_key text, p_window interval)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, date_bin(p_window, now(), timestamptz '2000-01-01'), 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count;
$$;

revoke execute on function public.bump_rate_limit(text, interval) from public, anon, authenticated;

-- ── Storage: huisstijl-assets per aanvraag (privé) ───────────────────
insert into storage.buckets (id, name, public)
values ('brand-assets', 'brand-assets', false)
on conflict (id) do nothing;
