-- Startlijst met collega's. Nieuwe namen: gewoon toevoegen in de Supabase-UI (Table editor → collegas).
insert into public.collegas (naam, volgorde) values
  ('Wendy', 10),
  ('Nicole', 20),
  ('Mara', 30),
  ('Karen', 40),
  ('Dyonn', 50),
  ('Desiree', 60),
  ('Daphne', 70),
  ('Britt', 80),
  ('Bo', 90),
  ('Inge', 100),
  ('Elise', 110),
  ('Cindy', 120),
  ('Danielle', 130),
  ('Nahdia', 140),
  ('Fleur', 150),
  ('Mandy', 160),
  ('Melanie', 170),
  ('Naomi', 180),
  ('Yentl', 190),
  ('Dominique', 200)
on conflict (naam) do nothing;
