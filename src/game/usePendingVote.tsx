// Shared vote feedback for Round 2 and Round 3. Votes can take about a second to be acknowledged under load, so a tap
// must show at once that it was heard, and "registered" may only appear after the server acknowledged it.
//
// Acknowledged means: send() resolved with ok, or the server's own view already shows the choice (`acked`).
// This hook never changes game state; it only tracks what the phone is showing while a command is in flight.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import type { SendResult } from './commands.ts';

export type PendingStatus = 'idle' | 'sending' | 'registered';

export const SLOW_AFTER_MS = 3000;

export interface PendingVote<T extends string> {
  /** The option to show as chosen (acknowledged by the server, or tapped and still being sent). */
  choice: T | null;
  status: PendingStatus;
  /** Still pending after SLOW_AFTER_MS. */
  slow: boolean;
  /** A definite failure; buttons are enabled again. Null while sending or after registration. */
  error: string | null;
  /** True while sending or once registered: the buttons must stay disabled. */
  locked: boolean;
  submit: (value: T, run: () => Promise<SendResult>) => Promise<void>;
}

/**
 * @param acked    the value the server's view already shows for this vote (view.me.myVote, or 'ARMED' for the leash)
 * @param resetKey changes when the vote context changes (clash, wave, step); clears any local pending state
 */
export function usePendingVote<T extends string>(acked: T | null | undefined, resetKey: string): PendingVote<T> {
  const [pending, setPending] = useState<T | null>(null);
  const [okSent, setOkSent] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const token = useRef(0);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    token.current += 1; // ignore results of an earlier context
    clearTimer();
    setPending(null);
    setOkSent(false);
    setSlow(false);
    setError(null);
  }, [resetKey]);

  useEffect(() => clearTimer, []);

  const submit = useCallback(
    async (value: T, run: () => Promise<SendResult>) => {
      token.current += 1;
      const mine = token.current;
      clearTimer();
      setPending(value);
      setOkSent(false);
      setSlow(false);
      setError(null);
      timer.current = setTimeout(() => {
        if (token.current === mine) setSlow(true);
      }, SLOW_AFTER_MS);
      let r: SendResult;
      try {
        r = await run();
      } catch {
        r = { ok: false, error: 'NETWORK', message: 'No connection. Your vote was not sent. Try again.' };
      }
      if (token.current !== mine) return;
      clearTimer();
      setSlow(false);
      if (r.ok) setOkSent(true);
      else {
        setPending(null);
        setError(r.message ?? 'Vote not accepted. Try again.');
      }
    },
    [],
  );

  const choice = acked ?? pending;
  const status: PendingStatus = acked || (pending && okSent) ? 'registered' : pending ? 'sending' : 'idle';
  return {
    choice,
    status,
    slow: status === 'sending' && slow,
    error: status === 'idle' ? error : null,
    locked: status !== 'idle',
    submit,
  };
}

/** The text under the buttons. Renders nothing while idle (show your own error / hint then). */
export function VoteFeedback({ vote, registeredText = 'Vote registered', testId }: { vote: Pick<PendingVote<string>, "status" | "slow">; registeredText?: string; testId?: string }) {
  if (vote.status === 'sending') {
    return (
      <div data-testid={testId ? `${testId}-sending` : undefined} role="status" className="rounded-xl border border-[#c4a45a]/50 bg-[#161922] p-3 text-center space-y-1">
        <div className="flex items-center justify-center space-x-2 text-base font-bold text-[#f4f0e8]">
          <Loader2 className="w-5 h-5 animate-spin text-[#e5cb87]" />
          <span>Sending your vote…</span>
        </div>
        {vote.slow && <p className="text-sm text-amber-300">Still sending — keep this screen open</p>}
      </div>
    );
  }
  if (vote.status === 'registered') {
    return (
      <div data-testid={testId} role="status" className="rounded-xl border border-emerald-500/60 bg-emerald-950/50 p-3 text-center">
        <div className="flex items-center justify-center space-x-2 text-base font-bold text-emerald-200">
          <Check className="w-5 h-5" />
          <span>{registeredText}</span>
        </div>
      </div>
    );
  }
  return null;
}
