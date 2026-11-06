-- De preview van het torenscherm bij het opleveren.
--
-- Het design uit de subtaak Oplevering komt in een openbare bucket, op een pad met een onraadbare
-- sleutel (<sleutel>/ontwerp.<ext> en <sleutel>/meta.json). De pagina torenscherm/ van het formulier
-- zet het daar vandaan op de foto van het torenscherm. Zie shared/torenscherm-preview.ts.

-- ── Previews ─────────────────────────────────────────────────────────
-- Eén rij per bijlage in Asana: een proef en daarna "Verstuur nu" krijgen dezelfde link, en een
-- nieuw bestand (een volgende versie) een nieuwe.
create table if not exists public.torenscherm_previews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  aanvraag_id uuid not null references public.aanvragen (id) on delete cascade,
  -- De gid van de bijlage in Asana.
  bestand_gid text not null unique,
  -- De bestandsnaam zoals hij in Asana stond, en de naam op de knop.
  bestandsnaam text not null,
  naam text not null,
  -- 24 hextekens; de link is https://marketing-nbc.github.io/designaanvraag/torenscherm/?p=<sleutel>.
  sleutel text not null unique check (sleutel ~ '^[0-9a-f]{24}$'),
  bytes bigint not null default 0
);

comment on table public.torenscherm_previews is
  'Torenscherm-designs uit de subtaak Oplevering, als preview op de foto van het torenscherm (bucket torenscherm-previews).';

create index if not exists torenscherm_previews_aanvraag_idx on public.torenscherm_previews (aanvraag_id);

alter table public.torenscherm_previews enable row level security;
revoke all on public.torenscherm_previews from anon, authenticated;
grant select, insert, update, delete on public.torenscherm_previews to service_role;

-- ── De bucket ────────────────────────────────────────────────────────
-- Openbaar: de pagina haalt het design op zonder in te loggen, net als de aanvrager die de link
-- doorstuurt. Er is geen policy op storage.objects voor anon, dus de inhoud is niet op te sommen;
-- wie de sleutel niet heeft, vindt niets. `do update` zodat de limieten opnieuw af te dwingen zijn.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'torenscherm-previews',
  'torenscherm-previews',
  true,
  52428800, -- 50 MB, de grens van Supabase; zie TORENSCHERM_MAX_BYTES
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/json'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
