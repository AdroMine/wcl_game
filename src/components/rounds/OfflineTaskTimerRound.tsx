import React, { useState } from 'react';
import { useGameSession } from '../../context/GameContext';
import type { OfflineTaskData } from '../../types';
import { Beer, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import confetti from 'canvas-confetti';

export const OfflineTaskTimerRound: React.FC = () => {
  const { team, currentRound, submitAnswer } = useGameSession();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string; points?: number } | null>(null);

  if (!currentRound || currentRound.type !== 'OFFLINE_TASK_TIMER') return null;

  const data = currentRound.data as OfflineTaskData;
  const roundCompleted = team?.round_submissions[currentRound.id]?.completed;
  const completedSubmission = team?.round_submissions[currentRound.id];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    try {
      setSubmitting(true);
      setSubmitResult(null);
      const res = await submitAnswer(code.trim());
      setSubmitResult(res);

      if (res.success && res.isCorrect) {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#c4a45a', '#fb923c', '#f4f0e8'],
        });
      }
    } catch (err: any) {
      setSubmitResult({ success: false, message: err.message || 'Verification failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Physical Challenge Prompt */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
        <div className="flex items-center space-x-2">
          <Beer className="w-5 h-5 text-[#fb923c]" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#fb923c] font-bold">
            Physical Pub Trial
          </span>
        </div>
        <h3 className="text-lg font-serif font-black text-[#f4f0e8]">
          {currentRound.title}
        </h3>
        <div className="p-4 rounded-xl bg-[#161922] border border-[#2a2e3d] text-sm text-[#f4f0e8] font-medium leading-relaxed">
          {data.prompt}
        </div>
      </div>

      {/* Rules Checklist */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-2.5">
        <div className="flex items-center space-x-2 text-xs font-serif font-bold text-[#f4f0e8]">
          <ShieldAlert className="w-4 h-4 text-[#c4a45a]" />
          <span>Trial Requirements</span>
        </div>
        <ul className="space-y-2">
          {data.rules.map((rule, idx) => (
            <li key={idx} className="flex items-start space-x-2 text-xs text-[#8e95a5]">
              <span className="text-[#c4a45a] font-mono font-bold mt-0.5">•</span>
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Verification Code Box */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-serif font-bold text-[#f4f0e8]">
            Enter Pub Verification Rune
          </span>
          <span className="text-[10px] font-mono text-[#c4a45a]">
            +{data.points} PTS
          </span>
        </div>

        {roundCompleted ? (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-center space-y-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" />
            <h5 className="text-base font-serif font-black text-emerald-200">
              Trial Passed!
            </h5>
            <div className="inline-block px-3 py-1 bg-emerald-900/60 border border-emerald-500/40 rounded-full text-xs font-mono font-bold text-emerald-300">
              +{completedSubmission?.pointsAwarded} PTS Awarded
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ENTER VERIFICATION RUNE..."
              maxLength={12}
              className="w-full bg-[#161922] border border-[#2a2e3d] focus:border-[#c4a45a] rounded-xl px-4 py-3 text-center text-sm font-mono font-bold tracking-widest text-[#f4f0e8] outline-none uppercase"
            />

            {submitResult && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
                  submitResult.success
                    ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200'
                    : 'bg-red-950/60 border-red-500/60 text-red-200'
                }`}
              >
                {submitResult.success ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
                )}
                <span>{submitResult.message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !code.trim()}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] text-[#08090c] font-serif font-bold text-sm tracking-wider shadow-gold-glow transition-all disabled:opacity-50"
            >
              {submitting ? 'Validating...' : 'Claim Victory Rune'}
            </button>
            <p className="text-[10px] text-center text-[#8e95a5] font-mono">
              (Game Master can also award points directly from Admin Panel)
            </p>
          </form>
        )}
      </div>
    </div>
  );
};
