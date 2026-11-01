import React, { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, X } from 'lucide-react';
import type { Briefing } from '../../shared/protocol.ts';

/** Story and rules of a round. Always dismissible: the round clock runs on the server, nobody waits for a modal. */
export const RoundBriefingModal: React.FC<{ briefing: Briefing; onClose: () => void; animate: boolean }> = ({ briefing, onClose, animate }) => {
  const total = briefing.sentences.length;
  const [shown, setShown] = useState(animate ? 1 : total);

  useEffect(() => {
    if (!animate || shown >= total) return;
    const id = setTimeout(() => setShown(n => n + 1), 1600);
    return () => clearTimeout(id);
  }, [animate, shown, total]);

  const showRules = shown >= total;

  return (
    <div role="dialog" aria-label="Round briefing" data-testid="briefing" className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center">
      <div className="bg-[#10121a] border border-[#3a4157] rounded-t-3xl sm:rounded-2xl w-full max-w-[480px] max-h-[92vh] flex flex-col shadow-2xl">
        <div className="p-4 border-b border-[#2a2e3d] flex items-start justify-between bg-[#161922]/70">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold">Descent Stage #{briefing.stageNumber}</span>
            <h3 className="text-xl font-serif font-black text-[#f4f0e8]">{briefing.title}</h3>
            <p className="text-xs text-[#a9b4c7] font-serif italic">{briefing.subtitle}</p>
          </div>
          <button onClick={onClose} aria-label="Close briefing" className="w-11 h-11 flex items-center justify-center rounded-lg border border-[#2a2e3d] text-[#8e95a5]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 text-[#cbd5e1] flex-1">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-[#c4a45a]/15 border border-[#c4a45a]/30 text-[#e5cb87] text-[10px] font-mono uppercase tracking-widest font-bold">
              <BookOpen className="w-3.5 h-3.5" />
              <span>The Underworld Chronicles</span>
            </div>
            {briefing.sentences.slice(0, shown).map((s, i) => (
              <p
                key={i}
                className={`font-serif transition-all duration-700 ${i === shown - 1 && animate ? 'text-base font-black text-[#f4f0e8]' : 'text-sm italic text-[#a9b4c7]'}`}
              >
                {s}
              </p>
            ))}
          </div>

          {showRules && (
            <div className="space-y-2.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#e5cb87] font-bold block">How your crew plays</span>
              {briefing.rules.map((r, i) => (
                <div key={i} className="p-3 rounded-xl bg-[#161922] border border-[#3a4157]">
                  <h4 className="text-sm font-bold text-[#f4f0e8]">{r.title}</h4>
                  <div className="text-sm text-[#cbd5e1] leading-relaxed">{r.desc}</div>
                </div>
              ))}
              <div className="p-3 rounded-xl bg-gradient-to-r from-[#161922] to-[#1e2433] border border-[#c4a45a]/60 flex items-start space-x-3">
                <CheckCircle2 className="w-5 h-5 text-[#e5cb87] shrink-0 mt-0.5" />
                <div>
                  <span className="text-[10px] font-mono text-[#e5cb87] uppercase font-bold block">Victory Objective</span>
                  <div className="text-sm text-[#f4f0e8] font-medium leading-snug">{briefing.objective}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-[#161922] border-t border-[#3a4157]">
          <button
            data-testid="briefing-close"
            onClick={onClose}
            className="w-full min-h-[56px] rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] text-[#08090c] font-serif font-black text-base"
          >
            {showRules ? 'Got it' : 'Skip story'}
          </button>
        </div>
      </div>
    </div>
  );
};
