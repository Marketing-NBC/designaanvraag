-- Eén druk op een knop in Asana, één keer uitvoeren.
--
-- Asana stuurt dezelfde wijziging soms twee keer, in twee webhook-berichten die een fractie van een
-- seconde na elkaar binnenkomen. Allebei halen ze de taak op, allebei zien ze "Stuur proef naar mij",
-- en dan gingen er twee proefmails de deur uit (5 november 2026). Met een claim wint de eerste; de
-- tweede ziet dat er al iemand mee bezig is en doet niets.
--
-- Na afloop wordt de claim weer vrijgegeven, zodat je meteen opnieuw kunt drukken. Blijft er een
-- hangen (de function viel om), dan mag hij na het opgegeven aantal seconden worden overgenomen.

create table if not exists public.knop_claims (
  -- Bijvoorbeeld "oplevermail:proef:<taak-gid>".
  sleutel text primary key,
  geclaimd_op timestamptz not null default now()
);

comment on table public.knop_claims is
  'Wie een knop in Asana nu uitvoert, zodat een dubbel bericht van Asana hem niet twee keer uitvoert.';

alter table public.knop_claims enable row level security;
revoke all on public.knop_claims from anon, authenticated;
grant select, insert, update, delete on public.knop_claims to service_role;

-- True als deze aanroep de claim kreeg: er was er geen, of de vorige is ouder dan p_geldig_seconden.
create or replace function public.claim_knop(p_sleutel text, p_geldig_seconden integer)
returns boolean
language sql
security definer
set search_path = public
as $$
  with c as (
    insert into public.knop_claims as k (sleutel, geclaimd_op)
    values (p_sleutel, now())
    on conflict (sleutel) do update set geclaimd_op = now()
      where k.geclaimd_op < now() - make_interval(secs => p_geldig_seconden)
    returning 1
  )
  select exists (select 1 from c);
$$;

revoke execute on function public.claim_knop(text, integer) from public, anon, authenticated;
grant execute on function public.claim_knop(text, integer) to service_role;
