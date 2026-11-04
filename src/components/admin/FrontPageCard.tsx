// "Front page": opens The Underworld Times (the shareable end-of-night card) from the admin panel so the host can
// screenshot it. It only exists once the game is FINISHED (GET /api/recap answers 404 before), so earlier it just
// says so. The card itself is a lazy chunk, fetched only when this is opened.
import React, { useState } from 'react';
import { Newspaper } from 'lucide-react';
import { BTN, H, MUTED } from './kit';

const FrontPagePanel = React.lazy(() => import('../../../games/underworld/recap/ui/FrontPagePanel').then(m => ({ default: m.FrontPagePanel })));

export const FrontPageCard: React.FC<{ finished: boolean; sid?: string; v?: number }> = ({ finished, sid, v }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2" data-testid="admin-front-page">
      <div className={H}>Front page</div>
      <button data-testid="admin-front-page-open" className={BTN} disabled={!finished} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Newspaper className="w-4 h-4 shrink-0" />
        {open ? 'Hide the front page' : 'Open the front page'}
      </button>
      {!finished && (
        <div className={MUTED} data-testid="admin-front-page-note">
          Available after Finish.
        </div>
      )}
      {finished && open && (
        <div className="space-y-2">
          <React.Suspense fallback={<div className={MUTED}>Loading…</div>}>
            <FrontPagePanel sid={sid} v={v} />
          </React.Suspense>
          <div className={MUTED}>Screenshot it and post it. Every phone shows the same card.</div>
        </div>
      )}
    </div>
  );
};
