import { useEffect, useState } from 'react';

/** Re-render every `intervalMs` (for countdowns). */
export function useTick(intervalMs = 250): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN(x => x + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return n;
}
