// Environment parsing. Nothing in here is ever logged or serialised except the non-secret fields.
export interface ServerConfig {
  port: number;
  nodeEnv: string;
  production: boolean;
  /** Secret. Never log or serialise. */
  adminToken: string | null;
  publicUrl: string | null;
  allowedOrigins: string[];
  allowAnyOrigin: boolean;
  snapshotStore: 'file' | 'supabase';
  snapshotDir: string;
  supabaseUrl: string | null;
  /** Secret. Never log or serialise. */
  supabaseKey: string | null;
  staticDir: string | null;
  trustProxy: boolean;
  warnings: string[];
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const warnings: string[] = [];
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const DEV_ADMIN_TOKEN = 'dev-admin-token-change-me';
  const rawAdminToken = env.ADMIN_TOKEN && env.ADMIN_TOKEN.length > 0 ? env.ADMIN_TOKEN : null;
  // Development only: fall back to a fixed, documented token so `npm run dev` works on every OS.
  const adminToken = rawAdminToken ?? (nodeEnv === 'production' ? null : DEV_ADMIN_TOKEN);
  if (!rawAdminToken && nodeEnv !== 'production') warnings.push('ADMIN_TOKEN not set: using the development default (see docs/RUNBOOK.md)');
  if (production && !adminToken) throw new Error('ADMIN_TOKEN is required when NODE_ENV=production');
  if (production && adminToken && adminToken.length < 16) throw new Error('ADMIN_TOKEN must be at least 16 characters in production');

  const port = env.PORT === undefined || env.PORT === '' ? 3001 : Number.parseInt(env.PORT, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a number between 0 and 65535');

  const rawOrigins = (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  let allowAnyOrigin = false;
  let allowedOrigins = rawOrigins.filter(o => o !== '*');
  if (rawOrigins.includes('*')) {
    if (production) warnings.push("ALLOWED_ORIGIN='*' is ignored in production");
    else allowAnyOrigin = true;
  }
  if (!production && rawOrigins.length === 0) allowAnyOrigin = true; // development default
  if (production && allowedOrigins.length === 0) warnings.push('ALLOWED_ORIGIN is not set: cross-origin requests are not allowed');
  allowedOrigins = [...new Set(allowedOrigins)];

  const store = (env.SNAPSHOT_STORE || 'file').toLowerCase();
  if (store !== 'file' && store !== 'supabase') throw new Error("SNAPSHOT_STORE must be 'file' or 'supabase'");
  const supabaseUrl = env.SUPABASE_URL ? env.SUPABASE_URL.replace(/\/+$/, '') : null;
  const supabaseKey = env.SUPABASE_SECRET_KEY || null;
  if (store === 'supabase' && (!supabaseUrl || !supabaseKey)) throw new Error('SNAPSHOT_STORE=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY');

  return {
    port,
    nodeEnv,
    production,
    adminToken,
    publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : null,
    allowedOrigins,
    allowAnyOrigin,
    snapshotStore: store,
    snapshotDir: env.SNAPSHOT_DIR || './data',
    supabaseUrl,
    supabaseKey,
    staticDir: env.STATIC_DIR || null,
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY !== 'false' && env.TRUST_PROXY !== '0' : true,
    warnings,
  };
}
