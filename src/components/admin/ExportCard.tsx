// "Download game data": the full record of the game as JSON (analysis) or CSV (one row per vote or action).
// The admin token goes in the Authorization header (never the URL); the file is saved from a Blob.
import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadExport } from '../../game/admin';
import { BTN, H, MUTED } from './kit';

export const ExportCard: React.FC<{ title?: string }> = ({ title = 'Download game data' }) => {
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);
  const [note, setNote] = useState('');
  const go = async (kind: 'json' | 'csv') => {
    if (busy) return;
    setBusy(kind);
    setNote('');
    const r = await downloadExport(kind);
    setBusy(null);
    setNote(r.ok ? `Saved ${r.filename}.` : r.error ?? 'Download failed.');
  };
  return (
    <div className="space-y-2" data-testid="admin-export">
      <div className={H}>{title}</div>
      <div className="grid grid-cols-2 gap-2">
        <button data-testid="admin-export-json" disabled={busy !== null} className={BTN} onClick={() => void go('json')}>
          <Download className="w-4 h-4 shrink-0" />
          {busy === 'json' ? 'Preparing…' : 'JSON'}
        </button>
        <button data-testid="admin-export-csv" disabled={busy !== null} className={BTN} onClick={() => void go('csv')}>
          <Download className="w-4 h-4 shrink-0" />
          {busy === 'csv' ? 'Preparing…' : 'CSV'}
        </button>
      </div>
      <div className={MUTED} data-testid="admin-export-note">
        {note || 'Crews, votes, outcomes and timings of every round. JSON for analysis, CSV for a spreadsheet.'}
      </div>
    </div>
  );
};
