import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useGame } from '../game/useGame';
import { readName, writeName } from '../game/session';
import { BTN_GOLD, ErrorNote } from './ui';

/** Shown only when the server has confirmed it does not know this device. Name entry only. */
export const JoinModal: React.FC = () => {
  const { send } = useGame();
  const [name, setName] = useState(readName());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter your name.');
      return;
    }
    setLoading(true);
    setError(null);
    writeName(name.trim());
    const r = await send('JOIN', { name: name.trim() });
    setLoading(false);
    if (!r.ok) setError(r.message ?? 'Could not join. Try again.');
  };

  return (
    <div className="min-h-[75vh] flex flex-col justify-center items-center py-8">
      <div className="w-full max-w-[440px] bg-[#10121a] border border-[#3a4157] rounded-2xl p-6 shadow-2xl">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-serif font-black tracking-wide text-[#f4f0e8]">Enter the Underworld</h2>
          <p className="text-base text-[#cbd5e1] font-serif italic">Unite with other lost souls and escape.</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="join-name" className="block text-base text-[#e5cb87] mb-1.5 font-bold">
              Your name
            </label>
            <input
              id="join-name"
              data-testid="join-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              maxLength={24}
              autoComplete="off"
              className="w-full min-h-[56px] bg-[#161922] border border-[#3a4157] focus:border-[#c4a45a] focus:ring-1 focus:ring-[#c4a45a] rounded-xl px-4 py-3 text-base text-[#f4f0e8] placeholder-[#8e95a5] outline-none transition-all font-sans"
            />
          </div>

          <ErrorNote text={error} />

          <button
            type="submit"
            data-testid="join-submit"
            disabled={loading}
            className={BTN_GOLD}
          >
            <span>{loading ? 'Joining…' : 'Join'}</span>
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
};
