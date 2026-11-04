// The front page on its own, fetched from the public recap: used by the admin panel ("Front page") and by the
// /front-page preview. Shows a skeleton while loading and a retry button when the fetch keeps failing.
import React from 'react';
import { FrontPage, FrontPageSkeleton } from './FrontPage.tsx';
import { useRecap } from './useRecap.ts';

export const FrontPagePanel: React.FC<{ sid?: string; v?: number }> = ({ sid, v }) => {
  const { recap, failed, retry } = useRecap(true, sid, v);
  if (recap) return <FrontPage recap={recap} />;
  return (
    <div className="space-y-2" data-testid="front-page-wait">
      <FrontPageSkeleton />
      {failed && (
        <div className="text-center space-y-2" data-testid="front-page-error">
          <p className="text-sm text-[#cbd5e1]">The front page did not load. It is only available once the game is finished.</p>
          <button onClick={retry} className="min-h-[48px] px-5 rounded-xl border border-[#c4a45a]/60 bg-[#161922] text-[#e5cb87] font-serif font-black text-sm">
            Try again
          </button>
        </div>
      )}
    </div>
  );
};
