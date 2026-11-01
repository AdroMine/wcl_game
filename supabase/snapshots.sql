-- Snapshot table for the game server. The server writes the full game state here every few seconds
-- while play is going on (and at every phase change) and reads the newest row only when it boots.
-- Only the server's secret (service role) key may touch it: RLS is enabled with NO policies, so the
-- anon and authenticated roles can neither read nor write.
create table if not exists snapshots (
  id bigserial primary key,
  created_at timestamptz default now(),
  version int not null,
  state jsonb not null
);

alter table snapshots enable row level security;
-- (intentionally no policies)

create index if not exists snapshots_id_desc on snapshots (id desc);
