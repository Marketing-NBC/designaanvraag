-- De 3D-preview van de ledkolom bij het opleveren.
--
-- Staat er bij een LED-kolom-aanvraag een video in de subtaak Oplevering, dan maakt de repository
-- NBC-3D-ledkolom-Preview er een 3D-preview van, en krijgt de aanvrager de link in de mail. Het bouwen
-- duurt een paar minuten; drukt Marketing in de tussentijd op "Verstuur nu", dan wacht de mail tot de
-- preview online staat en gaat hij daarna vanzelf de deur uit.

-- ── Previews ─────────────────────────────────────────────────────────
create table if not exists public.ledkolom_previews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  aanvraag_id uuid not null references public.aanvragen (id) on delete cascade,
  -- De eerste, tweede, ... video in de subtaak. Een volgende versie met evenveel video's komt op
  -- dezelfde rij, en dus op dezelfde link: een verstuurde link blijft werken en toont de nieuwste.
  volgnummer integer not null,
  -- De map in de 3D-repo: docs/p/<slug>/. Door ons gekozen, zodat de link vooraf bekend is.
  slug text not null unique,
  -- De naam op het startscherm van de preview.
  naam text not null,
  -- De Asana-bijlage waar de preview nu van gemaakt wordt (of is). Komt er een nieuwe video, dan
  -- verandert dit en gaat de status terug op "wacht".
  bijlage_gid text not null,
  bestandsnaam text not null default '',
  -- wacht: de 3D-repo mag hem ophalen en bouwen; klaar: staat online; mislukt: zie fout.
  status text not null default 'wacht' check (status in ('wacht', 'klaar', 'mislukt')),
  fout text,
  -- Wanneer de build voor deze bijlage gestart is; staat hij na een kwartier nog op wacht, dan
  -- start een volgende druk op de knop hem opnieuw.
  gevraagd_op timestamptz not null default now(),
  klaar_op timestamptz,
  unique (aanvraag_id, volgnummer)
);

comment on table public.ledkolom_previews is
  '3D-previews van ledkolomvideo''s uit de subtaak Oplevering; gebouwd door de repo NBC-3D-ledkolom-Preview.';

create index if not exists ledkolom_previews_wacht_idx on public.ledkolom_previews (status) where status = 'wacht';

alter table public.ledkolom_previews enable row level security;
revoke all on public.ledkolom_previews from anon, authenticated;
grant select, insert, update, delete on public.ledkolom_previews to service_role;

-- ── Een oplevering kan wachten op de preview ─────────────────────────
alter table public.opleveringen drop constraint if exists opleveringen_status_check;
alter table public.opleveringen
  add constraint opleveringen_status_check check (status in ('bezig', 'wacht_op_preview', 'verstuurd', 'mislukt'));

-- Wie op "Verstuur nu" drukte (Asana-gebruiker). Een wachtende mail wordt later verstuurd, zonder
-- dat iemand drukt; dan staat deze naam er toch onder, en krijgt deze persoon de melding als het misgaat.
alter table public.opleveringen
  add column if not exists door text;
