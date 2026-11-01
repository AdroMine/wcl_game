// File snapshot store. Atomic: the new snapshot is written and fsynced to a temp file, the current
// one is renamed to "previous", and the temp file is renamed to "latest". A crash at any point leaves
// at least one complete snapshot, and loading falls back from latest to previous.
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { gameStateProblem } from './validate.ts';
import type { GameState } from '../engine/index.ts';
import type { LoadedSnapshot, SnapshotStore, SnapshotToSave } from './types.ts';

export class FileSnapshotStore implements SnapshotStore {
  readonly name = 'file';
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  async save(snap: SnapshotToSave): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = this.path('snapshot.tmp.json');
    const body = `{"format":1,"savedAt":${snap.savedAt},"version":${snap.version},"state":${snap.stateJson}}`;
    const fh = await open(tmp, 'w');
    try {
      await fh.writeFile(body, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(this.path('snapshot.latest.json'), this.path('snapshot.previous.json'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    await rename(tmp, this.path('snapshot.latest.json'));
  }

  private async tryRead(name: string): Promise<LoadedSnapshot | null> {
    let text: string;
    try {
      text = await readFile(this.path(name), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    try {
      const j = JSON.parse(text) as { savedAt?: unknown; version?: unknown; state?: unknown };
      if (typeof j.savedAt !== 'number' || gameStateProblem(j.state) !== null) return null;
      const state = j.state as GameState;
      return { state, savedAt: j.savedAt, version: state.version, source: `file:${name}` };
    } catch {
      return null; // truncated or corrupt: try the next candidate
    }
  }

  async loadLatest(): Promise<LoadedSnapshot | null> {
    return (await this.tryRead('snapshot.latest.json')) ?? (await this.tryRead('snapshot.previous.json'));
  }

  /** Test helper. */
  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}
