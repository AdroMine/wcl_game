import fs from 'fs';

async function deploy() {
  const env = fs.readFileSync('.env', 'utf8');
  const token = env.match(/SUPABASE_ACCESS_TOKEN=(.+)/)![1].trim();
  const ref = 'gbvprlfovncxnsohowyf';

  const sql = `
CREATE TABLE IF NOT EXISTS round3_session (
  id text PRIMARY KEY,
  session_id text DEFAULT 'main',
  current_wave integer DEFAULT 1,
  current_phase text DEFAULT 'BLUFF',
  phase_ends_at bigint,
  is_sudden_death boolean DEFAULT false,
  sudden_death_teams text[],
  sudden_death_state jsonb,
  team_states jsonb DEFAULT '{}'::jsonb,
  wave_votes jsonb DEFAULT '{}'::jsonb,
  wave_reports jsonb DEFAULT '{}'::jsonb,
  podium jsonb DEFAULT '{"gold_team_id": null, "silver_team_id": null, "bronze_team_id": null}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS round3_team_state (
  team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  current_distance_meters integer DEFAULT 0,
  has_escaped boolean DEFAULT false,
  escape_rank integer,
  escaped_in_wave integer,
  cerberus_used boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS round3_wave_votes (
  id text PRIMARY KEY,
  wave_number integer NOT NULL,
  team_id text REFERENCES teams(id) ON DELETE CASCADE,
  player_votes jsonb DEFAULT '{}'::jsonb,
  resolved_vessel text NOT NULL,
  cerberus_target_team_id text,
  cerberus_guessed_vessel text,
  meters_gained integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS and public policies
ALTER TABLE round3_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE round3_team_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE round3_wave_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read round3_session" ON round3_session;
DROP POLICY IF EXISTS "Allow public update round3_session" ON round3_session;
CREATE POLICY "Allow public read round3_session" ON round3_session FOR SELECT TO anon, authenticated, service_role USING (true);
CREATE POLICY "Allow public update round3_session" ON round3_session FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read round3_team_state" ON round3_team_state;
DROP POLICY IF EXISTS "Allow public update round3_team_state" ON round3_team_state;
CREATE POLICY "Allow public read round3_team_state" ON round3_team_state FOR SELECT TO anon, authenticated, service_role USING (true);
CREATE POLICY "Allow public update round3_team_state" ON round3_team_state FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public read round3_wave_votes" ON round3_wave_votes;
DROP POLICY IF EXISTS "Allow public update round3_wave_votes" ON round3_wave_votes;
CREATE POLICY "Allow public read round3_wave_votes" ON round3_wave_votes FOR SELECT TO anon, authenticated, service_role USING (true);
CREATE POLICY "Allow public update round3_wave_votes" ON round3_wave_votes FOR ALL TO anon, authenticated, service_role USING (true) WITH CHECK (true);
`;

  console.log('Deploying Round 3 tables to Supabase...');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });

  const resText = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', resText);
}

deploy().catch(console.error);
