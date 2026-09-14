-- Geheimen van Asana-webhooks (handshake via X-Hook-Secret). Alleen de edge function (secret key) leest en schrijft.
create table if not exists public.asana_webhooks (
  resource_gid text        not null,
  secret       text        not null,
  created_at   timestamptz not null default now(),
  primary key (resource_gid, secret)
);

alter table public.asana_webhooks enable row level security;
revoke all on public.asana_webhooks from anon, authenticated;
