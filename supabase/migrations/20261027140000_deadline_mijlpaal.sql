-- De mijlpaal in het project "Deadlines designaanvragen".
--
-- Een Asana-kalender kan alleen op de vervaldatum, en die kiest Marketing zelf bij het inplannen.
-- Om toch alle aanvragen op hun deadline te zien krijgt elke aanvraag een mijlpaal in een eigen
-- project, met de deadline als vervaldatum. De webhook houdt hem bij: verschuift de deadline,
-- wordt de taak afgerond of weggegooid, dan beweegt de mijlpaal mee. Daarvoor moet hij te vinden
-- zijn, vandaar deze kolom.
alter table public.aanvragen
  add column if not exists asana_deadline_gid text;

comment on column public.aanvragen.asana_deadline_gid is
  'Gid van de deadline-mijlpaal in het project "Deadlines designaanvragen"; leeg als die er (nog) niet is.';
