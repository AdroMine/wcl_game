import type { GameState } from '../engine/index.ts';

/** What a store hands back on boot. */
export interface LoadedSnapshot {
  state: GameState;
  /** Wall-clock time the snapshot was taken (ms since epoch). */
  savedAt: number;
  version: number;
  source: string;
}

/** What the writer hands to a store. stateJson is serialised once and shared by all stores. */
export interface SnapshotToSave {
  version: number;
  savedAt: number;
  stateJson: string;
}

export interface SnapshotStore {
  readonly name: string;
  save(snap: SnapshotToSave): Promise<void>;
  /** Newest valid snapshot, or null when there is none. Throws when the store cannot be reached. */
  loadLatest(): Promise<LoadedSnapshot | null>;
}
