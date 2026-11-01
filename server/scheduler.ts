// The scheduler turns passed deadlines into system commands. Every 250 ms it asks the engine which
// deadlines have passed (due) and applies the commands. System command ids are derived from the phase
// sequence number, so a step is applied exactly once even if the event loop stalls, a tick runs twice
// or the same command is delivered twice.
import { due } from './engine/index.ts';
import type { Runtime } from './runtime.ts';

export interface SchedulerOptions {
  intervalMs?: number;
  /** Most steps one tick may apply (a safety net, not a behaviour: due() yields at most one at a time). */
  maxStepsPerTick?: number;
  onError?: (e: unknown) => void;
}

export class Scheduler {
  private readonly runtime: Runtime;
  private readonly intervalMs: number;
  private readonly maxSteps: number;
  private readonly onError: (e: unknown) => void;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  ticks = 0;
  applied = 0;

  constructor(runtime: Runtime, opts: SchedulerOptions = {}) {
    this.runtime = runtime;
    this.intervalMs = opts.intervalMs ?? 250;
    this.maxSteps = opts.maxStepsPerTick ?? 20;
    this.onError = opts.onError ?? (e => console.error('scheduler error', e instanceof Error ? e.message : 'unknown'));
  }

  /** One scheduler pass. Public so tests can drive it with a fake clock. Returns the number of steps applied. */
  tick(): number {
    this.ticks++;
    let n = 0;
    const tried = new Set<string>();
    for (let i = 0; i < this.maxSteps; i++) {
      const now = this.runtime.now();
      const cmds = due(this.runtime.state, now).filter(c => !tried.has(c.commandId));
      if (cmds.length === 0) break;
      for (const c of cmds) {
        tried.add(c.commandId);
        if (this.runtime.apply(c, now).changed) n++;
      }
    }
    this.applied += n;
    return n;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (): void => {
      const t0 = Date.now();
      try {
        this.tick();
      } catch (e) {
        this.onError(e);
      }
      if (!this.running) return;
      // Re-arm relative to the planned grid so a slow tick does not make the cadence drift.
      const delay = Math.max(10, this.intervalMs - (Date.now() - t0));
      this.timer = setTimeout(loop, delay);
    };
    this.timer = setTimeout(loop, this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
