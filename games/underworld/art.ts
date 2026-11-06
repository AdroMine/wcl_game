// Illustrations for the phone UI. Only the URL strings are in the main bundle; the bytes download when an <img> uses them.
import lobby from './art/lobby.webp';
import end from './art/end.webp';
import r1 from './art/r1.webp';
import r2 from './art/r2.webp';
import r3 from './art/r3.webp';
import rowboat from './art/e-rowboat.webp';
import laurel from './art/e-laurel.webp';
import hands from './art/e-hands.webp';
import dagger from './art/e-dagger.webp';
import angel from './art/e-angel.webp';
import wave from './art/e-wave.webp';
import holly from './art/e-holly.webp';

export const ART = {
  lobby,
  end,
  briefing: { 1: r1, 2: r2, 3: r3 } as Record<number, string>,
  emblem: { rowboat, laurel, hands, dagger, angel, wave, holly },
  /** Warm the browser cache. Never blocks anything; a failure is ignored. */
  preload(urls: string[]): void {
    for (const u of urls) {
      try {
        new Image().src = u;
      } catch {
        /* ignore */
      }
    }
  },
};
