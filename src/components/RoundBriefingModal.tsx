import React, { useState, useEffect } from 'react';
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
    desc: string;
  }[];
  objective: string;
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
        title: '1. Lay Phones in Order',
        desc: 'Check your slot number (#1 to #5) and place your phones side-by-side across the table in sequence.',
      },
      {
        icon: <Key className="w-4 h-4 text-[#34d399]" />,
        title: '2. Decipher & Submit Codeword',
        desc: 'Combine your letters to decipher the 2-word codeword revealed across your screens. Any teammate can submit!',
      },
    ],
    objective: 'Decipher the 2-word ancient codeword to unseal the door (+150 PTS max).',
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
        title: '1. Private Huddle',
        desc: 'Whisper with your table only. Agree on your secret strategy: will you honor peace or strike?',
      },
      {
        icon: <MessageSquare className="w-4 h-4 text-[#38bdf8]" />,
        title: '2. The Dialogue',
        desc: 'Turn to the rival table. Look them in the eyes and negotiate your pact. (Bluffing is permitted!).',
      },
      {
        icon: <Vote className="w-4 h-4 text-[#c084fc]" />,
        title: '3. Secret Blind Vote',
        desc: 'Vote on your phone (TRUCE or AMBUSH). Majority rules; Negotiator role breaks 2–2 ties.',
      },
    ],
    objective: '3 Clashes. Truce gives shared honor (+75); Ambushing gives total robbery (+150 vs 0).',
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
        icon: <MessageSquare className="w-4 h-4 text-[#e5cb87]" />,
        title: '1. Bluff the Room',
        desc: 'Stand up and debate across tables. Only 1 crew can take the Ghost Ship. Max 30% take Sailboats.',
      },
      {
        icon: <Compass className="w-4 h-4 text-[#38bdf8]" />,
        title: '2. 3 Escape Vessels',
        desc: 'Rowboat (+150m, safe). Sailboat (+300m, capsizes if crowded). Ghost Ship (+450m, solo only).',
      },
      {
        icon: <Sparkles className="w-4 h-4 text-[#f43f5e]" />,
        title: '3. Stygian Leash (Cerberus)',
        desc: 'If betrayed in Round 2, tether your rival: steal 50m if they float, or drag them down for +100m if they crash! 🕊️ Winds of Olympus: Unbroken truces grant a +75m starting boost!',
      },
    ],
    objective: 'First 3 crews to cross the 1,000m threshold escape and claim Gold, Silver & Bronze medals!',
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

  // Progressive sentence revelation with generous breathing room (2.8s per sentence)
  useEffect(() => {
    if (!isOpen) {
      setRevealedIndex(0);
      return;
    }

    if (!isAutoBriefing) {
      // Manual rules view: show all sentences immediately, no waiting
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

  if (!isOpen) return null;

  // Decide whether to show Story or Rules
  const showStory = isAutoBriefing ? secondsRemaining > 14 : manualTab === 'story';
  const showRules = isAutoBriefing ? secondsRemaining <= 14 : manualTab === 'rules';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/90 backdrop-blur-md select-none animate-fadeIn">
      <div className="w-full max-w-[460px] bg-[#10121a] border-2 border-[#c4a45a]/70 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] relative">
        {/* Top Header Banner */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-[#161922] via-[#1f2433] to-[#161922] border-b border-[#3a4157] flex items-center justify-between">
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
          <div className="flex border-b border-[#3a4157] bg-[#161922]">
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
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 font-sans text-[#cbd5e1] text-xs">
          {/* STAGE 1: THE LORE / STORY (Centered, generous pacing) */}
          {showStory && (
            <div className="space-y-4 py-2 animate-fadeIn text-center">
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#c4a45a]/15 border border-[#c4a45a]/30 text-[#e5cb87] text-[10px] font-mono uppercase tracking-widest font-bold">
                <BookOpen className="w-3.5 h-3.5" />
                <span>The Underworld Chronicles</span>
              </div>

              <div className="min-h-[160px] flex flex-col justify-center space-y-3 font-serif italic text-sm sm:text-base text-[#f4f0e8] leading-relaxed max-w-sm mx-auto">
                {briefing.sentences.slice(0, revealedIndex + 1).map((sentence, idx) => (
                  <p key={idx} className="transition-all duration-500">
                    {sentence}
                    {isAutoBriefing && idx === revealedIndex && revealedIndex < briefing.sentences.length - 1 && (
                      <span className="inline-block w-2 h-4 ml-1 bg-[#c4a45a] animate-pulse align-middle" />
                    )}
                  </p>
                ))}
              </div>

              {isAutoBriefing && (
                <div className="pt-2">
                  <div className="text-[11px] font-mono text-[#a9b4c7] animate-pulse">
                    Rules appearing shortly...
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STAGE 2: THE PHYSICAL RULES & OBJECTIVE */}
          {showRules && (
            <div className="space-y-4 py-1 animate-fadeIn">
              <div className="text-center space-y-1">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold block">
                  ⚔️ How Your Crew Plays (Physical Pub Rules)
                </span>
              </div>

              {/* Rules List */}
              <div className="space-y-2.5">
                {briefing.rules.map((rule, idx) => (
                  <div
                    key={idx}
                    className="p-3 sm:p-3.5 rounded-xl bg-[#161922] border border-[#3a4157] flex items-start space-x-3.5 shadow-sm"
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#10121a] border border-[#3a4157] flex items-center justify-center shrink-0 mt-0.5">
                      {rule.icon}
                    </div>
                    <div className="space-y-0.5">
                      <h4 className="text-xs sm:text-sm font-bold text-[#f4f0e8]">{rule.title}</h4>
                      <p className="text-[11px] text-[#cbd5e1] leading-relaxed">{rule.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Victory Goal Callout */}
              <div className="p-3 rounded-xl bg-gradient-to-r from-[#161922] to-[#1e2433] border border-[#c4a45a]/50 flex items-center space-x-3">
                <CheckCircle2 className="w-5 h-5 text-[#e5cb87] shrink-0" />
                <div>
                  <span className="text-[10px] font-mono text-[#e5cb87] uppercase font-bold block">
                    Victory Objective
                  </span>
                  <p className="text-[11px] text-[#f4f0e8] font-medium leading-snug">
                    {briefing.objective}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer / Progress Bar */}
        <div className="p-4 bg-[#161922] border-t border-[#3a4157] text-center">
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
