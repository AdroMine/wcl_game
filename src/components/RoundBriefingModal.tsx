import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  BookOpen,
  X,
  Shield,
  Key,
  Users,
  MessageSquare,
  Vote,
  Compass,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import type { RoundType } from '../types';

interface BriefingContent {
  stageNumber: number;
  stageTitle: string;
  subtitle: string;
  sentences: string[];
  rules: {
    icon: React.ReactNode;
    title: string;
    desc: React.ReactNode;
  }[];
  objective: React.ReactNode;
}

const BRIEFINGS: Record<string, BriefingContent> = {
  ASCII_SPLITTER: {
    stageNumber: 1,
    stageTitle: 'The Shattered Tablet',
    subtitle: 'Reconstruct the Ancient Tomb Codeword',
    sentences: [
      'Your crew of five is formed.',
      'Walking along Tartarus, you reach a sealed ancient door.',
      'You need a codeword to pass through.',
      'Pieces of a broken ancient stone tablet lie on the ground in front of you.',
      'Can you solve it in time to escape this place?',
    ],
    rules: [
      {
        icon: <Users className="w-4 h-4 text-[#e5cb87]" />,
        title: '1. Re-arrange Pieces',
        desc: (
          <span>
            <strong className="text-[#f4f0e8]">Lay phones side-by-side.</strong> Match and align the golden fracture runes to reconstruct the ancient stone tablet.
          </span>
        ),
      },
      {
        icon: <Key className="w-4 h-4 text-[#34d399]" />,
        title: '2. Decipher & Submit',
        desc: (
          <span>
            Read the connected 2-word phrase. <strong className="text-[#34d399]">Any teammate can type and submit</strong> on their phone screen.
          </span>
        ),
      },
    ],
    objective: (
      <span>
        Unseal the tomb gate before time expires. Fast solves award up to <strong className="text-[#e5cb87]">+300 PTS</strong> (50 PTS guaranteed floor).
      </span>
    ),
  },
  PRISONERS_DILEMMA: {
    stageNumber: 2,
    stageTitle: 'Shades in the Mist',
    subtitle: 'The 3-Clash Social Dilemma',
    sentences: [
      'You escape through the ancient door and stumble into a vast, cavernous hall as thick Stygian mist rolls in.',
      'Another door swings open to your flank—another crew of shades emerges from the shadows.',
      'Are these trustworthy friends, or enemies who will betray you?',
      'You must decide before you can move forward.',
    ],
    rules: [
      {
        icon: <Shield className="w-4 h-4 text-[#e5cb87]" />,
        title: '1. Private Huddle (50s)',
        desc: (
          <span>
            <strong className="text-[#f4f0e8]">Whisper at your table only.</strong> Agree on your team's secret stance: <span className="text-emerald-400 font-bold">Truce</span> or <span className="text-rose-400 font-bold">Ambush</span>.
          </span>
        ),
      },
      {
        icon: <MessageSquare className="w-4 h-4 text-[#38bdf8]" />,
        title: '2. The Dialogue (40s)',
        desc: (
          <span>
            <strong className="text-[#38bdf8]">Face your rival crew</strong> across the room to parley and make pacts. Bluffing is 100% permitted!
          </span>
        ),
      },
      {
        icon: <Vote className="w-4 h-4 text-[#c084fc]" />,
        title: '3. Secret Blind Vote (25s)',
        desc: (
          <span>
            Vote privately on your phone. <strong className="text-[#f4f0e8]">Majority decides</strong>; Negotiator role breaks 2–2 ties.
          </span>
        ),
      },
    ],
    objective: (
      <span>
        3 Clashes with escalating stakes (up to <strong className="text-[#e5cb87]">+900 PTS</strong>). Mutual Truce yields shared honour; Ambush risks mutual brawl (+15 PTS).
      </span>
    ),
  },
  ODYSSEY_ESCAPE_ROYALE: {
    stageNumber: 3,
    stageTitle: 'Escape from Tartarus',
    subtitle: 'The River Styx Escape Royale',
    sentences: [
      'You traverse the deep chambers of Tartarus and can finally see the exit, framed across the wide River Styx.',
      "But the terrifying howls of Cerberus echo behind you—Hades's trusted guardian hound is getting near!",
      'The door, visible across the far bank, is slowly starting to close.',
      'There are precious few minutes left.',
      'Can your crew reach the portal before it seals forever?',
    ],
    rules: [
      {
        icon: <Compass className="w-4 h-4 text-[#38bdf8]" />,
        title: '1. Choose Your Vessel',
        desc: (
          <span>
            🚣 <strong className="text-emerald-400">Rowboat</strong>: Safe (+150m) · ⛵ <strong className="text-cyan-400">Sailboat</strong>: Fast (+300m, max 30% fleet) · ⚡ <strong className="text-amber-400">Ghost Ship</strong>: Surge (+450m, 1 crew only).
          </span>
        ),
      },
      {
        icon: <Shield className="w-4 h-4 text-[#f43f5e]" />,
        title: '2. Congestion Hazards',
        desc: (
          <span>
            Overcrowded Sailboats <strong className="text-rose-400">capsize (0m)</strong>. Multiple Ghost Ships <strong className="text-rose-400">collide (-50m)</strong>.
          </span>
        ),
      },
      {
        icon: <Sparkles className="w-4 h-4 text-[#e5cb87]" />,
        title: '3. Moral Legacies',
        desc: (
          <span>
            🩸 <strong className="text-rose-400">Betrayed</strong>: Unleash Cerberus to leech rival meters. 🕊️ <strong className="text-emerald-400">Honourable</strong>: +75m starting boost.
          </span>
        ),
      },
    ],
    objective: (
      <span>
        Reach 1,000m across 4 waves. <strong className="text-[#e5cb87]">First 3 crews</strong> to cross into the portal win Gold, Silver & Bronze medals!
      </span>
    ),
  },
};

interface RoundBriefingModalProps {
  roundType: RoundType | string;
  isOpen: boolean;
  onClose: () => void;
  secondsRemaining?: number;
  isAutoBriefing?: boolean;
}

export const RoundBriefingModal: React.FC<RoundBriefingModalProps> = ({
  roundType,
  isOpen,
  onClose,
  secondsRemaining = 0,
  isAutoBriefing = false,
}) => {
  const briefing = BRIEFINGS[roundType] || BRIEFINGS.ASCII_SPLITTER;

  // In auto-briefing, if secondsRemaining > 14 show lore story; else show rules.
  // In manual mode (!isAutoBriefing), allow tab switching between story and rules.
  const [manualTab, setManualTab] = useState<'story' | 'rules'>('rules');
  const [revealedIndex, setRevealedIndex] = useState(0);

  // Progressive rule card revelation
  const [revealedRuleCount, setRevealedRuleCount] = useState<number>(1);

  // Lore scroll container and active sentence ref
  const loreContainerRef = useRef<HTMLDivElement>(null);
  const activeSentenceRef = useRef<HTMLParagraphElement>(null);

  // Decide whether to show Story or Rules
  const showStory = isAutoBriefing ? secondsRemaining > 14 : manualTab === 'story';
  const showRules = isAutoBriefing ? secondsRemaining <= 14 : manualTab === 'rules';

  // 1. Progressive sentence revelation in Lore Story (2.8s per sentence)
  useEffect(() => {
    if (!isOpen) {
      setRevealedIndex(0);
      return;
    }

    if (!isAutoBriefing) {
      // Manual rules view: show all sentences immediately
      setRevealedIndex(briefing.sentences.length - 1);
      return;
    }

    // Auto-briefing: slow sentence pacing
    setRevealedIndex(0);
    const interval = setInterval(() => {
      setRevealedIndex((prev) => {
        if (prev < briefing.sentences.length - 1) {
          return prev + 1;
        }
        clearInterval(interval);
        return prev;
      });
    }, 2800);

    return () => clearInterval(interval);
  }, [isOpen, isAutoBriefing, briefing]);

  // Smoothly center the newest active sentence without sudden jumps
  useEffect(() => {
    if (showStory && activeSentenceRef.current) {
      activeSentenceRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [revealedIndex, showStory]);

  // 2. Progressive Rule Cards Revelation in Rules view
  useEffect(() => {
    if (!isOpen) {
      setRevealedRuleCount(1);
      return;
    }

    if (!isAutoBriefing || !showRules) {
      // Manual rules view: reveal all rule cards and objective immediately
      setRevealedRuleCount(briefing.rules.length + 1);
      return;
    }

    // In auto-briefing: reveal rule boxes one by one with a sharp pace (every 2.0s)
    setRevealedRuleCount(1);
    const ruleInterval = setInterval(() => {
      setRevealedRuleCount((prev) => {
        const maxCount = briefing.rules.length + 1; // +1 for the Victory Objective
        if (prev < maxCount) {
          return prev + 1;
        }
        clearInterval(ruleInterval);
        return prev;
      });
    }, 2000);

    return () => clearInterval(ruleInterval);
  }, [isOpen, isAutoBriefing, showRules, briefing]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-md select-none animate-fadeIn">
      <div className="w-full max-w-[460px] bg-[#10121a] border-2 border-[#c4a45a]/70 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] relative">
        {/* Top Header Banner */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-[#161922] via-[#1f2433] to-[#161922] border-b border-[#3a4157] flex items-center justify-between shrink-0">
          <div className="space-y-0.5">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#e5cb87] font-black px-2 py-0.5 rounded bg-[#c4a45a]/20 border border-[#c4a45a]/40">
                DESCENT STAGE #{briefing.stageNumber}
              </span>
              {isAutoBriefing && (
                <span className="text-[10px] font-mono text-emerald-400 font-bold flex items-center space-x-1 animate-pulse">
                  <Clock className="w-3 h-3" />
                  <span>Unsealing in {secondsRemaining}s</span>
                </span>
              )}
            </div>
            <h2 className="text-base sm:text-lg font-serif font-black text-[#f4f0e8] tracking-wide">
              {briefing.stageTitle}
            </h2>
          </div>

          {/* Manual view allows closing; auto-briefing holds all players equally */}
          {!isAutoBriefing && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-[#161922] border border-[#3a4157] text-[#a9b4c7] hover:text-[#f4f0e8] hover:border-[#c4a45a] flex items-center justify-center transition-colors"
              title="Close Rules"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Manual view tabs */}
        {!isAutoBriefing && (
          <div className="flex border-b border-[#3a4157] bg-[#161922] shrink-0">
            <button
              onClick={() => setManualTab('rules')}
              className={`flex-1 py-2.5 text-xs font-mono font-bold transition-colors ${
                manualTab === 'rules'
                  ? 'text-[#e5cb87] border-b-2 border-[#c4a45a] bg-[#1f2433]'
                  : 'text-[#a9b4c7] hover:text-[#f4f0e8]'
              }`}
            >
              ⚔️ Physical Rules
            </button>
            <button
              onClick={() => setManualTab('story')}
              className={`flex-1 py-2.5 text-xs font-mono font-bold transition-colors ${
                manualTab === 'story'
                  ? 'text-[#e5cb87] border-b-2 border-[#c4a45a] bg-[#1f2433]'
                  : 'text-[#a9b4c7] hover:text-[#f4f0e8]'
              }`}
            >
              📖 Lore & Story
            </button>
          </div>
        )}

        {/* Body Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 font-sans text-[#cbd5e1] text-xs flex-1">
          {/* STAGE 1: THE LORE / STORY (Centered active line, fading history, upward scroll) */}
          {showStory && (
            <div className="space-y-3 py-1 animate-fadeIn flex flex-col items-center">
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#c4a45a]/15 border border-[#c4a45a]/30 text-[#e5cb87] text-[10px] font-mono uppercase tracking-widest font-bold">
                <BookOpen className="w-3.5 h-3.5" />
                <span>The Underworld Chronicles</span>
              </div>

              {/* Scrollable theater container with edge gradient masks */}
              <div
                ref={loreContainerRef}
                className="w-full h-[250px] overflow-y-auto px-4 py-20 space-y-6 text-center scroll-smooth relative rounded-2xl bg-[#0c0e14]/60 border border-[#2a2e3d]/60"
                style={{
                  maskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%)',
                }}
              >
                {briefing.sentences.map((sentence, idx) => {
                  const isCurrent = idx === revealedIndex;
                  const isFuture = idx > revealedIndex;

                  if (isFuture) return null;

                  return (
                    <p
                      key={idx}
                      ref={isCurrent ? activeSentenceRef : null}
                      className={`transition-all duration-700 ease-out select-none ${
                        isCurrent
                          ? 'text-sm sm:text-base font-serif font-black text-[#f4f0e8] scale-100 drop-shadow-[0_2px_12px_rgba(229,203,135,0.45)] py-2'
                          : 'text-xs sm:text-sm font-serif italic text-[#717b94] opacity-45 scale-95 py-0.5'
                      }`}
                    >
                      {sentence}
                      {isAutoBriefing && isCurrent && idx < briefing.sentences.length - 1 && (
                        <span className="inline-block w-2 h-3.5 ml-1.5 bg-[#c4a45a] animate-pulse align-middle rounded-sm" />
                      )}
                    </p>
                  );
                })}
              </div>

              {isAutoBriefing && (
                <div className="pt-1 text-center">
                  <div className="text-[11px] font-mono text-[#a9b4c7] animate-pulse">
                    Rules appearing shortly...
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STAGE 2: THE PHYSICAL RULES & OBJECTIVE (Revealed sequentially box-by-box with bold terms) */}
          {showRules && (
            <div className="space-y-3.5 py-1 animate-fadeIn">
              <div className="text-center space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold block">
                  ⚔️ How Your Crew Plays (Physical Pub Rules)
                </span>
              </div>

              {/* Rules List - Revealed one box at a time in auto-briefing */}
              <div className="space-y-2.5">
                {briefing.rules.map((rule, idx) => {
                  const isVisible = idx < revealedRuleCount;
                  const isJustRevealed = idx === revealedRuleCount - 1 && isAutoBriefing;

                  if (!isVisible) return null;

                  return (
                    <div
                      key={idx}
                      className={`p-3 sm:p-3.5 rounded-xl bg-[#161922] border transition-all duration-500 flex items-start space-x-3.5 shadow-sm animate-fadeIn ${
                        isJustRevealed
                          ? 'border-[#c4a45a] shadow-[0_0_15px_rgba(196,164,90,0.3)] scale-[1.01]'
                          : 'border-[#3a4157] scale-100'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#10121a] border border-[#3a4157] flex items-center justify-center shrink-0 mt-0.5">
                        {rule.icon}
                      </div>
                      <div className="space-y-0.5 flex-1">
                        <h4 className="text-xs sm:text-sm font-bold text-[#f4f0e8]">{rule.title}</h4>
                        <div className="text-[11px] text-[#cbd5e1] leading-relaxed">{rule.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Victory Goal Callout - Appears after the rules boxes */}
              {revealedRuleCount > briefing.rules.length && (
                <div className="p-3 rounded-xl bg-gradient-to-r from-[#161922] to-[#1e2433] border border-[#c4a45a]/60 flex items-center space-x-3 shadow-[0_0_15px_rgba(196,164,90,0.2)] animate-fadeIn">
                  <CheckCircle2 className="w-5 h-5 text-[#e5cb87] shrink-0" />
                  <div>
                    <span className="text-[10px] font-mono text-[#e5cb87] uppercase font-bold block">
                      Victory Objective
                    </span>
                    <div className="text-[11px] text-[#f4f0e8] font-medium leading-snug">
                      {briefing.objective}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer / Progress Bar */}
        <div className="p-4 bg-[#161922] border-t border-[#3a4157] text-center shrink-0">
          {isAutoBriefing ? (
            /* Auto-briefing countdown holds everyone equally: NO early enter button */
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-[#a9b4c7]">
                <span>Preparing the chamber...</span>
                <span className="text-[#e5cb87] font-bold">Unsealing in {secondsRemaining}s</span>
              </div>
              <div className="w-full h-2 bg-[#08090c] rounded-full overflow-hidden border border-[#3a4157]">
                <div
                  className="h-full bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] transition-all duration-500 rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, ((30 - secondsRemaining) / 30) * 100))}%` }}
                />
              </div>
            </div>
          ) : (
            /* Manual view has instant close button */
            <button
              onClick={onClose}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] font-serif font-black text-xs sm:text-sm tracking-wider shadow-gold-glow transition-all"
            >
              Return to Descent
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
