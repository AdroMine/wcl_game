import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, Clock, Compass, Key, MessageSquare, Shield, Sparkles, Users, Vote, X } from 'lucide-react';
import type { Briefing } from '../../shared/protocol.ts';
import { useGame } from '../game/useGame';
import { useTick } from '../game/useNow';

/** Pacing of the server-timed BRIEFING step (the server sizes the step from the same numbers). */
export const SENTENCE_MS = 2800;
export const STORY_PAUSE_MS = 3000;
export const RULE_MS = 2000;

const RULE_ICONS = [Users, Key, Shield, Compass, MessageSquare, Vote, Sparkles];

interface Props {
  briefing: Briefing;
  /** 'auto': driven by server time, no close until everything has appeared. 'manual': tabs, closable, all shown. */
  mode: 'auto' | 'manual';
  /** Auto mode: server time the briefing started and ends. */
  startedAt?: number;
  endsAt?: number | null;
  onClose: () => void;
}

export const RoundBriefingModal: React.FC<Props> = ({ briefing, mode, startedAt, endsAt, onClose }) => {
  const auto = mode === 'auto';
  useTick(250);
  const { serverNow } = useGame();
  const [manualTab, setManualTab] = useState<'story' | 'rules'>('rules');
  const activeRef = useRef<HTMLParagraphElement>(null);

  const nSent = briefing.sentences.length;
  const nRules = briefing.rules.length;
  const rulesStart = nSent * SENTENCE_MS + STORY_PAUSE_MS;
  const allShownAt = rulesStart + (nRules + 1) * RULE_MS;

  // serverNow() is frozen while the game is paused, so the animation freezes with it.
  const now = serverNow();
  const elapsed = auto && startedAt != null ? Math.max(0, now - startedAt) : Infinity;
  const secondsLeft = auto && endsAt != null ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
  const totalMs = auto && startedAt != null && endsAt != null ? Math.max(1, endsAt - startedAt) : 1;

  const showStory = auto ? elapsed < rulesStart : manualTab === 'story';
  const showRules = auto ? elapsed >= rulesStart : manualTab === 'rules';
  const revealedIndex = auto ? Math.min(nSent - 1, Math.floor(elapsed / SENTENCE_MS)) : nSent - 1;
  const storyDone = auto && elapsed >= nSent * SENTENCE_MS;
  const revealedRuleCount = auto ? Math.min(nRules + 1, Math.floor((elapsed - rulesStart) / RULE_MS) + 1) : nRules + 1;
  const everythingShown = auto && elapsed >= allShownAt;

  useEffect(() => {
    if (showStory && activeRef.current) activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [revealedIndex, showStory]);

  return (
    <div
      role="dialog"
      aria-label="Round briefing"
      data-testid="briefing"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-md select-none animate-fadeIn"
    >
      <div className="w-full max-w-[480px] bg-[#10121a] border-2 border-[#c4a45a]/70 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] relative">
        <div className="p-4 sm:p-5 bg-gradient-to-r from-[#161922] via-[#1f2433] to-[#161922] border-b border-[#3a4157] flex items-center justify-between shrink-0">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#e5cb87] font-black px-2 py-0.5 rounded bg-[#c4a45a]/20 border border-[#c4a45a]/40">
                DESCENT STAGE #{briefing.stageNumber}
              </span>
              {auto && (
                <span className="text-[11px] font-mono text-emerald-400 font-bold flex items-center space-x-1 animate-pulse">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Begins in {secondsLeft}s</span>
                </span>
              )}
            </div>
            <h2 className="text-xl font-serif font-black text-[#f4f0e8] tracking-wide">{briefing.title}</h2>
            <p className="text-xs text-[#a9b4c7] font-serif italic">{briefing.subtitle}</p>
          </div>
          {!auto && (
            <button
              onClick={onClose}
              aria-label="Close rules"
              title="Close Rules"
              className="w-11 h-11 shrink-0 rounded-full bg-[#161922] border border-[#3a4157] text-[#a9b4c7] hover:text-[#f4f0e8] hover:border-[#c4a45a] flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {!auto && (
          <div className="flex border-b border-[#3a4157] bg-[#161922] shrink-0">
            <button
              onClick={() => setManualTab('rules')}
              className={`flex-1 min-h-[48px] text-sm font-mono font-bold transition-colors ${
                manualTab === 'rules' ? 'text-[#e5cb87] border-b-2 border-[#c4a45a] bg-[#1f2433]' : 'text-[#a9b4c7] hover:text-[#f4f0e8]'
              }`}
            >
              Rules
            </button>
            <button
              onClick={() => setManualTab('story')}
              className={`flex-1 min-h-[48px] text-sm font-mono font-bold transition-colors ${
                manualTab === 'story' ? 'text-[#e5cb87] border-b-2 border-[#c4a45a] bg-[#1f2433]' : 'text-[#a9b4c7] hover:text-[#f4f0e8]'
              }`}
            >
              Story
            </button>
          </div>
        )}

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-[#cbd5e1] flex-1">
          {showStory && (
            <div className="space-y-3 py-1 animate-fadeIn flex flex-col items-center">
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#c4a45a]/15 border border-[#c4a45a]/30 text-[#e5cb87] text-[11px] font-mono uppercase tracking-widest font-bold">
                <BookOpen className="w-3.5 h-3.5" />
                <span>The Underworld Chronicles</span>
              </div>

              <div
                className="w-full h-[280px] overflow-y-auto px-4 py-20 space-y-6 text-center scroll-smooth relative rounded-2xl bg-[#0c0e14]/60 border border-[#2a2e3d]/60"
                style={{
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)',
                }}
              >
                {briefing.sentences.map((sentence, idx) => {
                  if (idx > revealedIndex) return null;
                  const isCurrent = idx === revealedIndex;
                  return (
                    <p
                      key={idx}
                      ref={isCurrent ? activeRef : null}
                      className={`transition-all duration-700 ease-out select-none ${
                        isCurrent
                          ? 'text-lg font-serif font-black text-[#f4f0e8] drop-shadow-[0_2px_12px_rgba(229,203,135,0.45)] py-2'
                          : 'text-sm font-serif italic text-[#8a94ad] opacity-60 scale-95 py-0.5'
                      }`}
                    >
                      {sentence}
                      {auto && isCurrent && !storyDone && (
                        <span className="inline-block w-2 h-4 ml-1.5 bg-[#c4a45a] animate-pulse align-middle rounded-sm" />
                      )}
                    </p>
                  );
                })}
              </div>

              {auto && storyDone && <div className="pt-1 text-center text-xs font-mono text-[#a9b4c7] animate-pulse">Rules appearing shortly...</div>}
            </div>
          )}

          {showRules && (
            <div className="space-y-3.5 py-1 animate-fadeIn">
              <div className="text-center">
                <span className="text-[11px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold block">How Your Crew Plays</span>
              </div>

              <div className="space-y-2.5">
                {briefing.rules.map((rule, idx) => {
                  if (idx >= revealedRuleCount) return null;
                  const Icon = RULE_ICONS[idx % RULE_ICONS.length];
                  const justRevealed = auto && idx === revealedRuleCount - 1 && !everythingShown;
                  return (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-xl bg-[#161922] border transition-all duration-500 flex items-start space-x-3.5 shadow-sm animate-fadeIn ${
                        justRevealed ? 'border-[#c4a45a] shadow-[0_0_15px_rgba(196,164,90,0.3)] scale-[1.01]' : 'border-[#3a4157] scale-100'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-[#10121a] border border-[#3a4157] flex items-center justify-center shrink-0 mt-0.5">
                        <Icon className="w-4 h-4 text-[#e5cb87]" />
                      </div>
                      <div className="space-y-0.5 flex-1">
                        <h4 className="text-base font-bold text-[#f4f0e8]">{rule.title}</h4>
                        <div className="text-sm text-[#cbd5e1] leading-relaxed">{rule.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {revealedRuleCount > nRules && (
                <div className="p-3.5 rounded-xl bg-gradient-to-r from-[#161922] to-[#1e2433] border border-[#c4a45a]/60 flex items-center space-x-3 shadow-[0_0_15px_rgba(196,164,90,0.2)] animate-fadeIn">
                  <CheckCircle2 className="w-5 h-5 text-[#e5cb87] shrink-0" />
                  <div>
                    <span className="text-[11px] font-mono text-[#e5cb87] uppercase font-bold block">Victory Objective</span>
                    <div className="text-sm text-[#f4f0e8] font-medium leading-snug">{briefing.objective}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 bg-[#161922] border-t border-[#3a4157] shrink-0 space-y-3">
          {auto ? (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm font-mono text-[#a9b4c7]">
                  <span>Preparing the chamber...</span>
                  <span className="text-[#e5cb87] font-bold">Round begins in {secondsLeft}s</span>
                </div>
                <div className="w-full h-2 bg-[#08090c] rounded-full overflow-hidden border border-[#3a4157]">
                  <div
                    className="h-full bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] transition-all duration-500 rounded-full"
                    style={{ width: `${Math.max(0, Math.min(100, (elapsed / totalMs) * 100))}%` }}
                  />
                </div>
              </div>
              {everythingShown && (
                <button
                  data-testid="briefing-close"
                  onClick={onClose}
                  className="w-full min-h-[56px] rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] font-serif font-black text-base tracking-wider shadow-gold-glow"
                >
                  Got it
                </button>
              )}
            </>
          ) : (
            <button
              data-testid="briefing-close"
              onClick={onClose}
              className="w-full min-h-[56px] rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] font-serif font-black text-base tracking-wider shadow-gold-glow"
            >
              Return to Descent
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
