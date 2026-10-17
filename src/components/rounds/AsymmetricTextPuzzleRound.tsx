import React, { useState } from 'react';
import { useGameSession } from '../../context/GameContext';
import type { AsymmetricPuzzleData } from '../../types';
import { KeyRound, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';

export const AsymmetricTextPuzzleRound: React.FC = () => {
  const { team, role, currentRound, submitAnswer } = useGameSession();
  const [answerInput, setAnswerInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string; points?: number } | null>(null);

  if (!currentRound || currentRound.type !== 'ASYMMETRIC_TEXT_PUZZLE') return null;

  const data = currentRound.data as AsymmetricPuzzleData;
  const roleClue = data.roleClues.find(c => c.roleId === role?.id) || {
    title: 'Wanderer Observation',
    clue: 'Listen carefully to the other roles in your crew to synthesize the secret incantation.',
    detail: 'Subterranean Whisper'
  };

  const roundCompleted = team?.round_submissions[currentRound.id]?.completed;
  const completedSubmission = team?.round_submissions[currentRound.id];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answerInput.trim()) return;

    try {
      setSubmitting(true);
      setSubmitResult(null);
      const res = await submitAnswer(answerInput.trim());
      setSubmitResult(res);

      if (res.success && res.isCorrect) {
        confetti({
          particleCount: 120,
          spread: 80,
          origin: { y: 0.6 },
          colors: ['#c4a45a', '#f4f0e8', '#38bdf8', '#c084fc', '#34d399'],
        });
      }
    } catch (err: any) {
      setSubmitResult({ success: false, message: err.message || 'Submission failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Intro Narrative */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-2">
        <div className="flex items-center space-x-2">
          <KeyRound className="w-4 h-4 text-[#c4a45a]" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#c4a45a] font-bold">
            Verbal Collaborative Puzzle
          </span>
        </div>
        <h3 className="text-lg font-serif font-black text-[#f4f0e8]">
          {data.themeTitle || 'The Gates of Tartarus'}
        </h3>
        <p className="text-xs text-[#8e95a5] leading-relaxed">
          {data.narrative}
        </p>
      </div>

      {/* Asymmetric Role Clue Card */}
      <div
        className="bg-[#10121a] border rounded-2xl p-5 shadow-xl space-y-3 relative overflow-hidden"
        style={{
          borderColor: role?.color || '#c4a45a',
        }}
      >
        <div className="flex items-center justify-between border-b border-[#2a2e3d] pb-2">
          <span className="text-[10px] font-mono uppercase tracking-wider font-bold" style={{ color: role?.color }}>
            Your Role Clue • {role?.name}
          </span>
          <span className="text-[10px] font-mono text-[#8e95a5]">
            DO NOT SHOW SCREEN — SPEAK IT!
          </span>
        </div>

        <div className="space-y-1.5">
          <h4 className="text-base font-serif font-bold text-[#f4f0e8]">
            {roleClue.title}
          </h4>
          <div className="p-3.5 rounded-xl bg-[#161922] border border-[#2a2e3d] text-sm text-[#f4f0e8] font-medium leading-relaxed">
            "{roleClue.clue}"
          </div>
          <p className="text-[10px] font-mono text-[#8e95a5]">
            Source: {roleClue.detail}
          </p>
        </div>
      </div>

      {/* Answer Submission */}
      <div className="bg-[#10121a] border border-[#2a2e3d] rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-[#c4a45a]" />
            <h4 className="text-sm font-serif font-bold text-[#f4f0e8]">
              Enter Gate Incantation
            </h4>
          </div>
          <span className="text-[10px] font-mono text-[#c4a45a]">
            +{data.points} PTS
          </span>
        </div>

        {roundCompleted ? (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-center space-y-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto" />
            <h5 className="text-base font-serif font-black text-emerald-200">
              Gate Unlocked!
            </h5>
            <p className="text-xs text-emerald-300 font-mono">
              Incantation: <strong className="text-white">{completedSubmission?.answerSubmitted}</strong>
            </p>
            <div className="inline-block mt-2 px-3 py-1 bg-emerald-900/60 border border-emerald-500/40 rounded-full text-xs font-mono font-bold text-emerald-300">
              +{completedSubmission?.pointsAwarded} PTS Awarded
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              value={answerInput}
              onChange={(e) => setAnswerInput(e.target.value.toUpperCase())}
              placeholder="ENTER UNIFIED ANSWER..."
              maxLength={20}
              className="w-full bg-[#161922] border border-[#2a2e3d] focus:border-[#c4a45a] rounded-xl px-4 py-3 text-center text-base font-mono font-black tracking-widest text-[#f4f0e8] outline-none uppercase"
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
              disabled={submitting || !answerInput.trim()}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] text-[#08090c] font-serif font-bold text-sm tracking-wider shadow-gold-glow transition-all disabled:opacity-50"
            >
              {submitting ? 'Testing Gate Seal...' : 'Utter Incantation'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
