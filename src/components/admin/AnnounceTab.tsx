// Announcements: the banner every phone and the projector show. Unchanged behaviour.
import React, { useState } from 'react';
import { adminPost } from '../../game/admin';
import type { AdminViewData } from '../../game/admin';
import { BOX, BTN, BTN_PRIMARY, H, INPUT } from './kit';

export const AnnounceTab: React.FC<{ view: AdminViewData; setLog: (s: string) => void; refreshSoon: () => void }> = ({ view, setLog, refreshSoon }) => {
  const [text, setText] = useState('');
  const send = async (t: string | null) => {
    const r = await adminPost('/api/admin/notice', { text: t });
    setLog(`${new Date().toLocaleTimeString()} Notice: ${r.ok ? 'OK' : 'FAILED'}`);
    refreshSoon();
  };
  return (
    <div className={BOX}>
      <div className={H}>Banner on every phone and the projector</div>
      <div className="text-sm text-[#cbd5e1] break-words">Current: {view.notice ? `"${view.notice}"` : 'none'}</div>
      <div className="flex flex-wrap gap-2">
        <input value={text} onChange={e => setText(e.target.value)} maxLength={140} placeholder="Back in two minutes" aria-label="Notice text" className={`${INPUT} flex-1 min-w-[200px]`} />
        <button className={BTN_PRIMARY} onClick={() => text.trim() && void send(text.trim()).then(() => setText(''))}>
          Show
        </button>
        <button className={BTN} onClick={() => void send(null)}>
          Clear
        </button>
      </div>
    </div>
  );
};
