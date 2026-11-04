-- Drie dingen die collega's na de presentatie vroegen:
--
-- 1. Akkoord geven op een oplevering, met een herinnering op elke werkdag tot er akkoord of
--    feedback is.
-- 2. Collega's aan een aanvraag koppelen: ze krijgen de bevestiging, de oplevering en de
--    herinneringen.
-- 3. Een menuscherm in het Engels.

-- ── Engels menu ──────────────────────────────────────────────────────
-- Staat ook in menu_inhoud, maar die is leeg als Marketing het menu in de taakbeschrijving
-- corrigeert. Deze kolom blijft dan staan.
alter table public.aanvragen
  add column if not exists menu_taal text not null default 'nl';

alter table public.aanvragen drop constraint if exists aanvragen_menu_taal_check;
alter table public.aanvragen
  add constraint aanvragen_menu_taal_check check (menu_taal in ('nl', 'en'));

comment on column public.aanvragen.menu_taal is
  'Taal van het menuscherm: nl of en. Engels kan alleen voor de pakketten in shared/menu-pakketten-en.json.';

-- ── Gekoppelde collega's ─────────────────────────────────────────────
-- Namen uit de tabel collegas. De adressen zoekt de function erbij op het moment dat er gemaild
-- wordt, zodat een adres dat later verandert ook voor een lopende aanvraag klopt.
alter table public.aanvragen
  add column if not exists gekoppelden text[] not null default '{}';

comment on column public.aanvragen.gekoppelden is
  'Collega''s die op de hoogte blijven: bevestiging, opleveringsmail en herinneringen. Namen uit collegas; een aanvulling kan er namen bij zetten.';

-- ── Akkoord en herinneringen ─────────────────────────────────────────
alter table public.opleveringen
  -- Alleen opleveringen van na deze migratie krijgen herinneringen. Zonder deze kolom zouden alle
  -- opleveringen van de afgelopen weken op de eerste ochtend ineens een herinnering krijgen.
  add column if not exists herinneren boolean not null default false,
  add column if not exists akkoord_op timestamptz,
  -- De naam die de collega op het akkoordscherm koos of typte.
  add column if not exists akkoord_door text,
  -- Er kwam een aanvulling (feedback) binnen na deze oplevering: dan stoppen de herinneringen.
  add column if not exists feedback_op timestamptz,
  -- Marketing sleepte de taak naar Afgerond, of er is een nieuwere versie verstuurd.
  add column if not exists gestopt_op timestamptz,
  add column if not exists gestopt_reden text,
  add column if not exists herinneringen integer not null default 0,
  add column if not exists laatste_herinnering timestamptz;

comment on column public.opleveringen.herinneren is
  'Krijgt deze oplevering een herinnering tot er akkoord of feedback is? Aan voor alles wat na 4 november 2026 verstuurd is.';

-- Wat de herinneringen elke ochtend ophalen: verstuurd, nog niets op gebeurd.
create index if not exists opleveringen_open_akkoord_idx on public.opleveringen (verstuurd_op)
  where status = 'verstuurd' and herinneren and akkoord_op is null and feedback_op is null and gestopt_op is null;

-- Een aanvulling kan collega's koppelen; de tabel aanvullingen bewaart wie dat waren.
alter table public.aanvullingen
  add column if not exists gekoppelden text[] not null default '{}';
