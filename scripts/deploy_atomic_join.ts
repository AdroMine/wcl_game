import fs from 'fs';

async function deploy() {
  const env = fs.readFileSync('.env', 'utf8');
  const tokenMatch = env.match(/SUPABASE_ACCESS_TOKEN=(.+)/);
  if (!tokenMatch) {
    console.error('SUPABASE_ACCESS_TOKEN not found in .env');
    process.exit(1);
  }
  const token = tokenMatch[1].trim();
  const ref = 'gbvprlfovncxnsohowyf';

  const sql = `
-- Drop existing functions if they have different parameter signatures
DROP FUNCTION IF EXISTS join_player_atomic(text, text);
DROP FUNCTION IF EXISTS reroll_player_role_atomic(text);

-- 1. Atomic Player Join Function
CREATE OR REPLACE FUNCTION join_player_atomic(p_name text, p_id text DEFAULT NULL)
RETURNS jsonb AS $$
DECLARE
  v_id text;
  v_code text;
  v_role text;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_rec record;
  v_chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  i integer;
BEGIN
  -- Reconnect existing player if p_id is provided and found
  IF p_id IS NOT NULL AND p_id <> '' THEN
    SELECT * INTO v_rec FROM players WHERE id = p_id;
    IF FOUND THEN
      UPDATE players SET
        name = COALESCE(NULLIF(TRIM(p_name), ''), v_rec.name),
        last_seen_at = v_now,
        last_seen = now(),
        is_online = true
      WHERE id = p_id
      RETURNING * INTO v_rec;
      RETURN to_jsonb(v_rec);
    END IF;
  END IF;

  -- Advisory transaction lock prevents concurrent join role races
  PERFORM pg_advisory_xact_lock(424242);

  -- Balance across the 5 canonical roles: navigator, oracle, scholar, torchbearer, negotiator
  -- Tie-break randomly among the least populated roles
  SELECT r.id INTO v_role
  FROM unnest(ARRAY['navigator', 'oracle', 'scholar', 'torchbearer', 'negotiator']) r(id)
  LEFT JOIN players p ON p.role_id = r.id
  GROUP BY r.id
  ORDER BY COUNT(p.id) ASC, random()
  LIMIT 1;

  -- Generate unique 3-char beacon code
  LOOP
    v_code := '';
    FOR i IN 1..3 LOOP
      v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM players WHERE join_code = v_code);
  END LOOP;

  v_id := COALESCE(NULLIF(p_id, ''), 'p_' || v_now || '_' || substr(md5(random()::text), 1, 7));

  -- Insert new player record
  INSERT INTO players (id, name, join_code, role_id, team_id, joined_at, last_seen_at, last_seen, is_online)
  VALUES (
    v_id,
    COALESCE(NULLIF(TRIM(p_name), ''), 'Shade-' || v_code),
    v_code,
    v_role,
    NULL,
    v_now,
    v_now,
    now(),
    true
  )
  RETURNING * INTO v_rec;

  RETURN to_jsonb(v_rec);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to public/anon/authenticated roles
GRANT EXECUTE ON FUNCTION join_player_atomic(text, text) TO anon, authenticated, service_role;

-- 2. Atomic Player Role Reroll Function
CREATE OR REPLACE FUNCTION reroll_player_role_atomic(p_id text)
RETURNS jsonb AS $$
DECLARE
  v_old_role text;
  v_new_role text;
  v_rec record;
BEGIN
  -- Advisory transaction lock
  PERFORM pg_advisory_xact_lock(424242);

  SELECT * INTO v_rec FROM players WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player % not found', p_id;
  END IF;

  v_old_role := v_rec.role_id;

  -- Pick from other 4 roles, prioritizing roles with lowest count, random tie-breaker
  SELECT r.id INTO v_new_role
  FROM unnest(ARRAY['navigator', 'oracle', 'scholar', 'torchbearer', 'negotiator']) r(id)
  LEFT JOIN players p ON p.role_id = r.id
  WHERE r.id <> COALESCE(v_old_role, '')
  GROUP BY r.id
  ORDER BY COUNT(p.id) ASC, random()
  LIMIT 1;

  UPDATE players
  SET role_id = v_new_role,
      last_seen_at = (extract(epoch from now()) * 1000)::bigint,
      last_seen = now()
  WHERE id = p_id
  RETURNING * INTO v_rec;

  RETURN to_jsonb(v_rec);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execution to public/anon/authenticated roles
GRANT EXECUTE ON FUNCTION reroll_player_role_atomic(text) TO anon, authenticated, service_role;
`;

  console.log('Sending SQL to Supabase Management API...');
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
