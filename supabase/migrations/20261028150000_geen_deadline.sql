-- Een interne aanvraag mag zonder deadline: "het mag klaar zijn wanneer het past". Bij een
-- evenement blijft de deadline verplicht; dat bewaakt het schema in de edge function.
alter table public.aanvragen
  alter column deadline drop not null;

comment on column public.aanvragen.deadline is
  'Wanneer de aanvrager het nodig heeft. Leeg bij een interne aanvraag zonder deadline.';
