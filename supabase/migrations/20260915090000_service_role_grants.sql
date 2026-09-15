-- Rechten voor service_role: de rol waarmee de edge functions en de worker werken.
--
-- Een project dat is aangemaakt met "Automatically expose new tables" uit, geeft nieuwe tabellen
-- géén rechten aan de Data API-rollen — en service_role hoort daar ook bij. Gevolg: elke query van
-- de functions faalt met "permission denied for table aanvragen", terwijl de publieke namenlijst het
-- wel doet (die heeft hierboven een expliciete grant). Daarom hier expliciet, zodat het project niet
-- afhangt van een vinkje in de dashboard-UI.

grant usage on schema public to service_role;

grant select, insert, update, delete on
  public.aanvragen,
  public.collegas,
  public.rate_limits,
  public.asana_webhooks
  to service_role;

grant select on public.collegas_public to service_role;

-- De rate-limit-functie is bewust afgeschermd van public, anon en authenticated. Dat revoke haalt
-- ook de impliciete rechten van service_role weg, dus die moet hem expliciet terugkrijgen.
grant execute on function public.bump_rate_limit(text, interval) to service_role;

-- Tabellen uit latere migraties krijgen dezelfde rechten, zodat dit niet elke keer opnieuw moet.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
