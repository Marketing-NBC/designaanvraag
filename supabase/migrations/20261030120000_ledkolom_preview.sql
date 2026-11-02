-- De 3D-preview van de ledkolom bij het opleveren.
--
-- Een ledkolomvideo is te groot voor Asana, dus die staat zoals altijd in een release van de repository
-- NBC-3D-ledkolom-Preview. Marketing plakt de link van die release in de subtaak Oplevering; de 3D-repo
-- maakt er een preview van, en de aanvrager krijgt de link in de mail. Drukt Marketing op "Verstuur nu"
-- voordat de preview online staat, dan wacht de mail en gaat hij daarna vanzelf de deur uit.

-- ── Previews ─────────────────────────────────────────────────────────
-- Eén rij per release-link per aanvraag.
create table if not exists public.ledkolom_previews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  aanvraag_id uuid not null references public.aanvragen (id) on delete cascade,
  -- De link naar de release (of naar één bestand daarin), zoals hij in de subtaak stond.
  bron text not null,
  -- wacht: de 3D-repo mag hem ophalen; klaar: staat online; mislukt: zie fout.
  status text not null default 'wacht' check (status in ('wacht', 'klaar', 'mislukt')),
  fout text,
  -- Wat de 3D-repo meldde: per video in de release [{"naam": ..., "slug": ...}]. De link is
  -- https://marketing-nbc.github.io/NBC-3D-ledkolom-Preview/p/<slug>/.
  previews jsonb not null default '[]',
  -- Wanneer de 3D-repo gevraagd is; staat hij na een kwartier nog op wacht, dan start een volgende
  -- druk op de knop hem opnieuw.
  gevraagd_op timestamptz not null default now(),
  klaar_op timestamptz,
  unique (aanvraag_id, bron)
);

comment on table public.ledkolom_previews is
  '3D-previews van ledkolommen, per release-link uit de subtaak Oplevering; gebouwd door de repo NBC-3D-ledkolom-Preview.';

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
