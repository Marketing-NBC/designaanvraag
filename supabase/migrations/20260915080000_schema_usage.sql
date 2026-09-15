-- Het project wordt aangemaakt met "Automatically expose new tables" uit: nieuwe tabellen krijgen
-- dan geen rechten voor de Data API-rollen. Dat is precies wat we willen — onze migraties geven zelf
-- expliciet toegang tot alleen de publieke namenlijst — maar die rollen moeten het schema wel mogen
-- gebruiken, anders komt zelfs een expliciete grant niet aan. Idempotent en onschadelijk als het al zo staat.

grant usage on schema public to anon, authenticated;

-- Voor de zekerheid nog eens de enige twee dingen die publiek leesbaar horen te zijn.
grant select on public.collegas_public to anon, authenticated;
grant select (naam, volgorde, actief) on public.collegas to anon, authenticated;
