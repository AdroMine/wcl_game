// ============================================================================
// ROUND PRELOADER
// ============================================================================
// Pre-fetches round chunks into browser cache during idle time after the initial
// page load. This keeps initial bundle small while protecting against flaky pub Wi-Fi
// by ensuring round code is already in memory before the Game Master begins a round.
// ============================================================================

export function preloadAllRounds() {
  if (typeof window === 'undefined') return;

  const doPreload = () => {
    // Dynamically import all rounds to trigger browser pre-caching
    import('../components/rounds/AsciiSplitterRound').catch(() => {});
    import('../components/rounds/ShadesInTheMistRound').catch(() => {});
    import('../components/rounds/AsymmetricTextPuzzleRound').catch(() => {});
    import('../components/rounds/OfflineTaskTimerRound').catch(() => {});
    import('../components/rounds/OdysseyEscapeRoyaleRound').catch(() => {});
  };

  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(doPreload, { timeout: 3000 });
  } else {
    setTimeout(doPreload, 1500);
  }
}
