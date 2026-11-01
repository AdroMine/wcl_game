// Snapshot persistence: write the full state every 5 s when it changed and immediately at every
// phase change, to every configured store; restore the newest snapshot on boot into a PAUSED state.
// The live game never reads a store, and a failing store never blocks or crashes the game.
import { randomBytes } from 'node:crypto';
import { createInitialState, reduce } from '../engine/index.ts';
import type { GameState } from '../engine/index.ts';
import type { ServerConfig } from '../config.ts';
import type { Runtime } from '../runtime.ts';
import { FileSnapshotStore } from './file.ts';
import { SupabaseSnapshotStore } from './supabase.ts';
import type { LoadedSnapshot, SnapshotStore, SnapshotToSave } from './types.ts';

export { FileSnapshotStore, SupabaseSnapshotStore };
export type { LoadedSnapshot, SnapshotStore, SnapshotToSave };
export { gameStateProblem, isGameState } from './validate.ts';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Serialised, coalescing writer for one store: only the newest pending snapshot is kept; failures back off. */
class StoreWriter {
  readonly store: SnapshotStore;
  private pending: SnapshotToSave | null = null;
  private inflight = false;
  private failures = 0;
  lastOkAt: number | null = null;
  lastOk = true;
  lastError: string | null = null;
  writes = 0;
  failedWrites = 0;
  private readonly backoffBaseMs: number;
  private readonly clock: () => number;

  constructor(store: SnapshotStore, backoffBaseMs: number, clock: () => number) {
    this.store = store;
    this.backoffBaseMs = backoffBaseMs;
    this.clock = clock;
  }

  submit(snap: SnapshotToSave): void {
    this.pending = snap;
    void this.pump();
  }

  get idle(): boolean {
    return !this.inflight && this.pending === null;
  }

  private async pump(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    try {
      while (this.pending) {
        const snap = this.pending;
        this.pending = null;
        try {
          await this.store.save(snap);
          this.failures = 0;
          this.lastOk = true;
          this.lastError = null;
          this.lastOkAt = this.clock();
          this.writes++;
        } catch (e) {
          this.failures++;
          this.failedWrites++;
          this.lastOk = false;
          this.lastError = e instanceof Error ? e.message.slice(0, 160) : 'unknown error';
          console.warn(`snapshot store '${this.store.name}' failed (${this.failures}): ${this.lastError}`);
          if (!this.pending) this.pending = snap; // retry with the newest data available
          await sleep(Math.min(30_000, this.backoffBaseMs * 2 ** Math.min(this.failures - 1, 6)));
        }
      }
    } finally {
      this.inflight = false;
    }
  }
}

export interface PersistenceOptions {
  intervalMs?: number;
  backoffBaseMs?: number;
  /** Boot-time load attempts per store (the first failure is retried with a growing pause). */
  loadAttempts?: number;
  loadRetryMs?: number;
  stores?: SnapshotStore[];
  clock?: () => number;
}

export interface PersistenceStatus {
  snapshotAgeSec: number | null;
  lastSnapshotOk: boolean;
  stores: Record<string, { ok: boolean; ageSec: number | null; writes: number; failures: number; error: string | null }>;
}

export class Persistence {
  private runtime: Runtime | null = null;
  private readonly writers: StoreWriter[];
  private readonly intervalMs: number;
  private readonly loadAttempts: number;
  private readonly loadRetryMs: number;
  private readonly clock: () => number;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private immediateScheduled = false;
  snapshotsTaken = 0;

  constructor(config: Pick<ServerConfig, 'snapshotStore' | 'snapshotDir' | 'supabaseUrl' | 'supabaseKey'>, opts: PersistenceOptions = {}) {
    this.clock = opts.clock ?? Date.now;
    this.intervalMs = opts.intervalMs ?? 5000;
    this.loadAttempts = opts.loadAttempts ?? 3;
    this.loadRetryMs = opts.loadRetryMs ?? 1000;
    const stores: SnapshotStore[] = opts.stores ?? [new FileSnapshotStore(config.snapshotDir)];
    if (!opts.stores && config.snapshotStore === 'supabase' && config.supabaseUrl && config.supabaseKey) {
      stores.push(new SupabaseSnapshotStore({ url: config.supabaseUrl, key: config.supabaseKey }));
    }
    this.writers = stores.map(s => new StoreWriter(s, opts.backoffBaseMs ?? 1000, this.clock));
  }

  /**
   * Find the newest snapshot across all stores. A store that cannot be reached is retried a few times
   * (so a brief Supabase blip does not silently start a fresh game), then ignored.
   */
  async loadNewest(): Promise<LoadedSnapshot | null> {
    const results = await Promise.all(
      this.writers.map(async w => {
        for (let attempt = 1; attempt <= this.loadAttempts; attempt++) {
          try {
            return await w.store.loadLatest();
          } catch (e) {
            console.warn(`snapshot load from '${w.store.name}' failed (attempt ${attempt}): ${e instanceof Error ? e.message : 'unknown'}`);
            if (attempt < this.loadAttempts) await sleep(this.loadRetryMs * attempt);
          }
        }
        return null;
      }),
    );
    let best: LoadedSnapshot | null = null;
    for (const r of results) {
      if (!r) continue;
      if (!best || r.savedAt > best.savedAt || (r.savedAt === best.savedAt && r.version > best.version)) best = r;
    }
    return best;
  }

  /** Bind to the live runtime and begin the snapshot schedule. */
  start(runtime: Runtime): void {
    if (this.unsubscribe) return;
    this.runtime = runtime;
    this.unsubscribe = runtime.subscribe(info => {
      this.dirty = true;
      if (info.phaseChanged && !this.immediateScheduled) {
        this.immediateScheduled = true;
        setImmediate(() => {
          this.immediateScheduled = false;
          this.snapshotNow();
        });
      }
    });
    this.timer = setInterval(() => {
      if (this.dirty) this.snapshotNow();
    }, this.intervalMs);
    this.timer.unref();
  }

  /** Serialise the current state and hand it to every store. Never throws. */
  snapshotNow(): void {
    try {
      if (!this.runtime) return;
      const state = this.runtime.state;
      const snap: SnapshotToSave = { version: state.version, savedAt: this.clock(), stateJson: JSON.stringify(state) };
      this.dirty = false;
      this.snapshotsTaken++;
      for (const w of this.writers) w.submit(snap);
    } catch (e) {
      console.error('snapshot failed', e instanceof Error ? e.message : 'unknown');
    }
  }

  /** Final snapshot + wait (bounded) until every store has written it. */
  async flush(timeoutMs = 5000): Promise<void> {
    this.snapshotNow();
    const deadline = this.clock() + timeoutMs;
    while (!this.writers.every(w => w.idle) && this.clock() < deadline) await sleep(20);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  status(): PersistenceStatus {
    const now = this.clock();
    const stores: PersistenceStatus['stores'] = {};
    let newest: number | null = null;
    let allOk = true;
    for (const w of this.writers) {
      stores[w.store.name] = { ok: w.lastOk, ageSec: w.lastOkAt == null ? null : Math.round((now - w.lastOkAt) / 100) / 10, writes: w.writes, failures: w.failedWrites, error: w.lastError };
      if (!w.lastOk) allOk = false;
      if (w.lastOkAt != null && (newest == null || w.lastOkAt > newest)) newest = w.lastOkAt;
    }
    return { snapshotAgeSec: newest == null ? null : Math.round((now - newest) / 100) / 10, lastSnapshotOk: allOk, stores };
  }
}

/**
 * Put a restored state into the PAUSED state, with the clock frozen at the moment the snapshot was taken
 * so no game time is lost or invented during the downtime. A state that is already paused is left alone.
 */
export function pauseRestored(state: GameState, savedAt: number, bootId: string): GameState {
  if (state.pausedAt != null) return state;
  const r = reduce(state, { commandId: `sys:restore-pause:${bootId}`, type: 'ADMIN_PAUSE', actor: { kind: 'admin' }, payload: {} }, { now: savedAt });
  // Pausing is not new game content: a restored state keeps the version it was saved with.
  return { ...r.state, version: state.version };
}

export interface BootResult {
  state: GameState;
  restoredFrom: string | null;
}

/** Choose the initial state: the newest snapshot (paused), or a fresh game with a random seed. */
export async function bootState(persistence: Persistence): Promise<BootResult> {
  const snap = await persistence.loadNewest();
  if (snap) {
    return { state: pauseRestored(snap.state, snap.savedAt || Date.now(), randomBytes(6).toString('hex')), restoredFrom: snap.source };
  }
  const seed = randomBytes(4).readUInt32BE(0);
  return { state: createInitialState({ seed }), restoredFrom: null };
}
