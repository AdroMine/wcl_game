// Supabase snapshot store over plain fetch (PostgREST). Write-only during play; read only on boot.
// The secret key is sent as apikey + Authorization headers and is never logged: errors carry only
// the operation name and the HTTP status.
import { gameStateProblem } from './validate.ts';
import type { GameState } from '../engine/index.ts';
import type { LoadedSnapshot, SnapshotStore, SnapshotToSave } from './types.ts';

export interface SupabaseOptions {
  url: string;
  key: string;
  keep?: number;
  timeoutMs?: number;
}

export class SupabaseSnapshotStore implements SnapshotStore {
  readonly name = 'supabase';
  private readonly base: string;
  private readonly key: string;
  private readonly keep: number;
  private readonly timeoutMs: number;

  constructor(opts: SupabaseOptions) {
    this.base = `${opts.url.replace(/\/+$/, '')}/rest/v1/snapshots`;
    this.key = opts.key;
    this.keep = opts.keep ?? 50;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, ...extra };
  }

  private async call(op: string, url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      throw new Error(`supabase ${op} failed: ${name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error'}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`supabase ${op} failed: HTTP ${res.status}`);
    }
    return res;
  }

  async save(snap: SnapshotToSave): Promise<void> {
    const res = await this.call('insert', this.base, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: `{"version":${snap.version},"state":${snap.stateJson}}`,
    });
    await res.body?.cancel().catch(() => undefined);
    // Prune to the newest `keep` rows; a failure here must not fail the save.
    try {
      const r = await this.call('prune-find', `${this.base}?select=id&order=id.desc&offset=${this.keep - 1}&limit=1`, { headers: this.headers() });
      const rows = (await r.json()) as { id: number }[];
      if (Array.isArray(rows) && rows.length > 0 && typeof rows[0].id === 'number') {
        const d = await this.call('prune-delete', `${this.base}?id=lt.${rows[0].id}`, { method: 'DELETE', headers: this.headers({ Prefer: 'return=minimal' }) });
        await d.body?.cancel().catch(() => undefined);
      }
    } catch (e) {
      console.warn(e instanceof Error ? e.message : 'supabase prune failed');
    }
  }

  async loadLatest(): Promise<LoadedSnapshot | null> {
    const res = await this.call('load', `${this.base}?select=version,state,created_at&order=id.desc&limit=5`, { headers: this.headers() });
    const rows = (await res.json()) as { version?: number; state?: unknown; created_at?: string }[];
    if (!Array.isArray(rows)) throw new Error('supabase load failed: unexpected response');
    for (const row of rows) {
      if (gameStateProblem(row.state) !== null) continue;
      const state = row.state as GameState;
      const savedAt = row.created_at ? Date.parse(row.created_at) : NaN;
      return { state, savedAt: Number.isFinite(savedAt) ? savedAt : 0, version: state.version, source: 'supabase' };
    }
    return null;
  }
}
