-- Bijlagen bij een aanvraag: een logo, een voorbeeld, een briefing. De browser uploadt ze met een
-- tijdelijke link rechtstreeks naar Storage; de edge function zet ze daarna als bijlage bij de
-- Asana-taak. De bytes gaan dus nooit door een function heen op de heenweg.

-- Eigen bucket, niet brand-assets erbij: andere schrijver (browser vs worker), andere bewaartermijn
-- (30 dagen vs blijvend), andere limieten. brand-assets aan banden leggen zou de worker beperken
-- zonder dat daar een reden voor is.
--
-- `file_size_limit` is de enige controle die niet te omzeilen is zodra een uploadlink is uitgegeven:
-- Storage meet de echte stream. `allowed_mime_types` kijkt alleen naar het type dat de uploader
-- ópgeeft, en stopt dus vergissingen, geen kwaadwil — vandaar dat de function de eerste bytes zelf
-- nog controleert. De lijst hieronder hoort gelijk te zijn aan TOEGESTANE_BESTANDEN in
-- shared/bijlagen.ts; shared/bijlagen.test.ts bewaakt dat.
--
-- `do update` in plaats van `do nothing`: zo zijn de limieten opnieuw af te dwingen als iemand ze in
-- het dashboard heeft aangepast.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'aanvraag-bijlagen',
  'aanvraag-bijlagen',
  false,
  26214400, -- 25 MB, gelijk aan MAX_BIJLAGE_BYTES
  array[
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Een eigen tabel en geen kolom op `aanvragen`: de rij moet al bestaan vóórdat de aanvraag bestaat.
-- Het bestand wordt midden in het formulier geüpload, de aanvraag ontstaat pas bij het versturen.
-- Eén tabel voor beide soorten ouders scheelt dubbele opruimlogica.
create table if not exists public.bijlagen (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Eén formuliersessie = één map in de opslag. Maakt opruimen en met de hand kijken overzichtelijk.
  groep_id uuid not null,
  aanvraag_id uuid references public.aanvragen (id) on delete cascade,
  aanvulling_id uuid references public.aanvullingen (id) on delete cascade,
  bestandsnaam text not null,
  mime text not null,
  bytes bigint not null,
  -- `<groep_id>/<id>.<ext>`; de naam van de collega komt hier bewust niet in voor.
  storage_path text not null unique,
  status text not null default 'verwacht'
    check (status in ('verwacht', 'gekoppeld', 'mislukt', 'geweigerd', 'opgeruimd')),
  asana_gid text,
  asana_url text,
  fout text,
  ip_hash text,
  gekoppeld_op timestamptz,
  opgeruimd_op timestamptz,
  -- Een bijlage hoort bij één aanvraag óf één aanvulling, of (nog) bij geen van beide.
  constraint bijlagen_een_ouder check (num_nonnulls(aanvraag_id, aanvulling_id) <= 1)
);

comment on table public.bijlagen is
  'Bestanden die een collega meestuurde; komen als bijlage bij de Asana-taak. De kopie in Storage wordt na 30 dagen opgeruimd, de rij blijft als spoor.';
comment on column public.bijlagen.status is
  'verwacht (geüpload, nog niet gekoppeld), gekoppeld, mislukt, geweigerd (bytes klopten niet met het type), opgeruimd.';

create index if not exists bijlagen_groep_idx on public.bijlagen (groep_id);
create index if not exists bijlagen_aanvraag_idx on public.bijlagen (aanvraag_id);
create index if not exists bijlagen_aanvulling_idx on public.bijlagen (aanvulling_id);
-- Waar de opruimer op zoekt: alles wat nog bytes in de opslag heeft staan.
create index if not exists bijlagen_opruim_idx on public.bijlagen (created_at) where status <> 'opgeruimd';

-- Zelfde regime als aanvragen en aanvullingen: RLS aan zonder policies, dus anon en authenticated
-- kunnen niets. Alleen de edge functions (secret key) komen erbij. Ook geen storage.objects-policies:
-- de uploadlink ís de autorisatie, al het andere gaat met de secret key.
alter table public.bijlagen enable row level security;
revoke all on public.bijlagen from anon, authenticated;
grant select, insert, update, delete on public.bijlagen to service_role;
