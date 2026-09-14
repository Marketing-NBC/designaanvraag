-- De view collegas_public filtert op `actief`; die kolom moet leesbaar zijn voor anon,
-- anders geeft PostgREST "permission denied for table collegas".
grant select (naam, volgorde, actief) on public.collegas to anon, authenticated;

-- Hardening: aanvragen en rate_limits zijn alleen voor de secret key (edge functions, worker).
revoke all on public.aanvragen from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;
