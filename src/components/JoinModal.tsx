import React, { useState } from 'react';
import { useGameSession } from '../context/GameContext';
import { ArrowRight } from 'lucide-react';

export const JoinModal: React.FC = () => {
  const { join } = useGameSession();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your name to enter the realm.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await join(name.trim());
    } catch (err: any) {
      setError(err.message || 'Failed to enter the Underworld.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-[440px] bg-[#10121a] border border-[#3a4157] rounded-2xl p-6 sm:p-7 shadow-2xl relative overflow-hidden">
        {/* Subtle mythic background glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-[#c4a45a]/15 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="text-center space-y-2.5 relative z-10">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#161922] border border-[#c4a45a]/60 text-[#c4a45a] font-serif font-black text-xl shadow-gold-glow mb-1">
            Ψ
          </div>
          <h2 className="text-2xl font-serif font-black tracking-wide text-[#f4f0e8] uppercase">
            Journey into the Underworld
          </h2>
          <p className="text-xs text-[#cbd5e1] leading-relaxed max-w-sm mx-auto font-serif italic">
            You awaken on the cold shores of the Underworld, a lone shade wandering the edge of Tartarus. The iron gates behind you have sealed forever, but rumors whisper of an escape route across the Styx. You cannot survive alone—unite with four other lost souls, bind your fates together, and claim your escape.
          </p>
        </div>

        {/* Join Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4 relative z-10">
          <div>
            <label className="block text-[11px] font-mono uppercase tracking-wider text-[#e5cb87] mb-1.5 font-bold">
              Your Name / Alias
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Orpheus, Elena, Sam..."
              maxLength={24}
              autoFocus
              className="w-full bg-[#161922] border border-[#3a4157] focus:border-[#c4a45a] focus:ring-1 focus:ring-[#c4a45a] rounded-xl px-4 py-3 text-sm text-[#f4f0e8] placeholder-[#a9b4c7]/50 outline-none transition-all font-sans"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-red-950/80 border border-red-500/60 text-red-200 text-xs font-medium">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-[#c4a45a] to-[#e5cb87] hover:from-[#d8b86e] hover:to-[#f0d89e] text-[#08090c] font-serif font-black text-sm tracking-wide flex items-center justify-center space-x-2 shadow-gold-glow transition-all disabled:opacity-50"
          >
            <span>{loading ? 'Entering Realm...' : 'Enter the Underworld'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Footer Notice */}
        <p className="text-[10px] text-[#a9b4c7]/70 text-center mt-6 font-mono">
          Live Realtime Session • Pub Resilient
        </p>
      </div>
    </div>
  );
};
