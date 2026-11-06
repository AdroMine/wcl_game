import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Anchor, CheckCircle2, Coins, Compass, Ghost, Key, MessageSquare, Sailboat, Shield, Sparkles, Users, Vote, X } from 'lucide-react';
import type { Briefing, BriefingRule } from '../../shared/protocol.ts';
import { briefingSchedule } from '../../shared/briefing.ts';
import { useGame } from '../game/useGame';
import { useTick } from '../game/useNow';
import { OVERLAY_TOP, useOverlay } from './ui';

const RULE_ICONS = [Users, Key, Shield, Compass, MessageSquare, Vote, Sparkles];
// The boats use the same icons and colours as the Round 3 vessel buttons.
const RULE_ICON: Record<NonNullable<BriefingRule['icon']>, [typeof Users, string]> = {
  users: [Users, 'text-[#e5cb87]'],
  talk: [MessageSquare, 'text-[#e5cb87]'],
  vote: [Vote, 'text-[#e5cb87]'],
  coins: [Coins, 'text-[#e5cb87]'],
  rowboat: [Anchor, 'text-emerald-300'],
  sailboat: [Sailboat, 'text-sky-300'],
  ghost: [Ghost, 'text-purple-300'],
};

interface Props {
  briefing: Briefing;
  /** 'auto': driven by server time, no close until everything has appeared. 'manual': tabs, closable, all shown. */
  mode: 'auto' | 'manual';
  /** Auto mode: server time the briefing started and ends. */
  startedAt?: number;
  endsAt?: number | null;
  onClose: () => void;
}

export const RoundBriefingModal: React.FC<Props> = ({ briefing, mode, startedAt, onClose }) => {
  const auto = mode === 'auto';
  useTick(250);
  useOverlay();
  const { serverNow } = useGame();
  const [manualTab, setManualTab] = useState<'story' | 'rules'>('rules');
  const activeRef = useRef<HTMLParagraphElement>(null);

  const nSent = briefing.sentences.length;
  const nRules = briefing.rules.length;
  // Same schedule the server used to size the step (shared/briefing.ts).
  const sched = useMemo(() => briefingSchedule(briefing), [briefing]);
  const rulesStart = sched.ruleAt[0];
  const allShownAt = sched.allShownAt;

  // serverNow() is frozen while the game is paused, so the animation freezes with it.
  const now = serverNow();
  const elapsed = auto && startedAt != null ? Math.max(0, now - startedAt) : Infinity;

  const showStory = auto ? elapsed < rulesStart : manualTab === 'story';
  const showRules = auto ? elapsed >= rulesStart : manualTab === 'rules';
  const revealedIndex = auto ? Math.max(0, sched.sentenceAt.filter(at => elapsed >= at).length - 1) : nSent - 1;
  const storyDone = auto && elapsed >= sched.storyEndsAt;
  const revealedRuleCount = auto ? sched.ruleAt.filter(at => elapsed >= at).length : nRules + 1;
  const everythingShown = auto && elapsed >= allShownAt;

  useEffect(() => {
    if (showStory && activeRef.current) activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [revealedIndex, showStory]);

  const btn =
    'w-full min-h-[56px] rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] font-serif font-black text-base tracking-wider';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Round briefing"
      data-testid="briefing"
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#08090c] select-none animate-fadeIn"
      style={{ paddingTop: OVERLAY_TOP }}
    >
      <div className="w-full max-w-[480px] flex flex-col min-h-0">
        <div className="px-4 pt-2 pb-3 border-b border-[#2a2e3d] flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-mono text-[#e5cb87]">Round {briefing.stageNumber}</div>
            <h2 className="text-2xl font-serif font-black text-[#f4f0e8] leading-tight">{briefing.title}</h2>
          </div>
          {!auto && (
            <button
              onClick={onClose}
              aria-label="Close rules"
              className="w-11 h-11 shrink-0 rounded-full bg-[#161922] border border-[#3a4157] text-[#a9b4c7] hover:text-[#f4f0e8] flex items-center justify-center transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {!auto && (
          <div className="flex border-b border-[#2a2e3d] shrink-0">
            {(['rules', 'story'] as const).map(t => (
              <button
                key={t}
                onClick={() => setManualTab(t)}
                className={`flex-1 min-h-[48px] text-base font-semibold transition-colors ${
                  manualTab === t ? 'text-[#e5cb87] border-b-2 border-[#c4a45a]' : 'text-[#a9b4c7] hover:text-[#f4f0e8]'
                }`}
              >
                {t === 'rules' ? 'Rules' : 'Story'}
              </button>
            ))}
          </div>
        )}

        <div className="px-4 py-4 overflow-y-auto space-y-3 text-[#cbd5e1] flex-1 min-h-0">
          {showStory &&
            (!auto ? (
              <div data-testid="briefing-story-full" className="space-y-3">
                {briefing.sentences.map((sentence, idx) => (
                  <p key={idx} className="text-lg font-serif text-[#f4f0e8] leading-relaxed">
                    {sentence}
                  </p>
                ))}
              </div>
            ) : (
              <div
                className="h-[320px] overflow-y-auto px-2 py-20 space-y-6 text-center scroll-smooth"
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
                        isCurrent ? 'text-xl font-serif font-black text-[#f4f0e8] py-2' : 'text-base font-serif italic text-[#9aa4bb] opacity-70 py-0.5'
                      }`}
                    >
                      {sentence}
                      {isCurrent && !storyDone && <span className="inline-block w-2 h-4 ml-1.5 bg-[#c4a45a] motion-safe:animate-pulse align-middle rounded-sm" />}
                    </p>
                  );
                })}
              </div>
            ))}

          {showRules && (
            <div className="space-y-2.5 animate-fadeIn">
              {briefing.rules.map((rule, idx) => {
                if (idx >= revealedRuleCount) return null;
                const [Icon, tone] = rule.icon ? RULE_ICON[rule.icon] : [RULE_ICONS[idx % RULE_ICONS.length], 'text-[#e5cb87]'];
                return (
                  <div key={idx} className="p-3.5 rounded-xl bg-[#161922] border border-[#3a4157] flex items-start space-x-3 animate-fadeIn">
                    <Icon className={`w-6 h-6 shrink-0 ${tone}`} aria-hidden="true" />
                    <div className="space-y-0.5 flex-1">
                      <h4 className="text-base font-bold text-[#f4f0e8]">{rule.title}</h4>
                      <div className="text-base text-[#cbd5e1] leading-snug whitespace-pre-line">{rule.desc}</div>
                    </div>
                  </div>
                );
              })}

              {revealedRuleCount > nRules && (
                <div className="p-3.5 rounded-xl bg-[#161922] border border-[#c4a45a]/60 flex items-start space-x-3 animate-fadeIn">
                  <CheckCircle2 className="w-5 h-5 text-[#e5cb87] shrink-0 mt-0.5" />
                  <div className="text-base text-[#f4f0e8] font-medium leading-snug">{briefing.objective}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {(!auto || everythingShown) && (
          <div className="px-4 pt-3 shrink-0 border-t border-[#2a2e3d]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
            <button data-testid="briefing-close" onClick={onClose} className={btn}>
              {auto ? 'Got it' : 'Back to the game'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
