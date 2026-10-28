-- De opleveringsmail: Marketing laat de aanvrager (en wie er verder bij hoort) weten dat het
-- ontwerp klaar is, met de bestanden erbij en een knop om feedback te geven.
--
-- Twee dingen zijn daarvoor nodig: het e-mailadres van de aanvrager, en een administratie van wat
-- er al is opgeleverd. Die laatste bepaalt het versienummer, voorkomt dat dezelfde oplevering twee
-- keer de deur uitgaat en is de bron voor "Opgeleverd" in het weekoverzicht.

-- ── E-mailadres bij de collega ───────────────────────────────────────
-- In te vullen in de Supabase-UI (Table editor → collegas), net als de namen. Niet publiek: de
-- grants op collegas zijn per kolom, en deze kolom staat daar bewust niet tussen.
alter table public.collegas
  add column if not exists email text;

comment on column public.collegas.email is
  'Waar de opleveringsmail naartoe gaat als deze collega de aanvraag deed. Leeg = alleen de adressen uit het Asana-veld "Ook mailen naar".';

-- ── Opleveringen ─────────────────────────────────────────────────────
create table if not exists public.opleveringen (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  aanvraag_id uuid not null references public.aanvragen (id) on delete cascade,
  -- De reactie "Oplevering: …" in Asana waar de mail van gemaakt is. Uniek: dezelfde reactie gaat
  -- maar één keer de deur uit, ook als iemand twee keer op de knop drukt. Mislukt het, dan wordt
  -- dezelfde rij bij de volgende poging opnieuw gebruikt.
  comment_gid text not null unique,
  -- 1 voor de eerste oplevering, 2 na de eerste ronde feedback, enzovoort.
  versie integer not null,
  ontvangers text[] not null default '{}',
  -- Per bestand: naam en grootte. De bestanden zelf staan in Asana.
  bijlagen jsonb not null default '[]',
  status text not null default 'bezig' check (status in ('bezig', 'verstuurd', 'mislukt')),
  fout text,
  verstuurd_op timestamptz
);

comment on table public.opleveringen is
  'Opleveringsmails: welke versie, aan wie, met welke bestanden, en of het gelukt is.';

create index if not exists opleveringen_aanvraag_idx on public.opleveringen (aanvraag_id, created_at desc);

alter table public.opleveringen enable row level security;
revoke all on public.opleveringen from anon, authenticated;
grant select, insert, update, delete on public.opleveringen to service_role;
