// Join QR, private standings, generic confirm and the typed RESET confirm.
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, RotateCcw } from 'lucide-react';
import type { AdminViewData } from '../../game/admin';
import { getRuntimeConfig } from '../../game/config';
import { BTN, BTN_PRIMARY, BTN_RED, INPUT, MUTED, MoralBadge, Modal, RankBadge, medal, membersOf, standings } from './kit';
import type { AskOptions } from './kit';

export function joinUrlOf(): string {
  return getRuntimeConfig().publicUrl || window.location.origin;
}

export const QrModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const url = joinUrlOf();
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 640, color: { dark: '#08090c', light: '#ffffff' } })
      .then(u => live && setQr(u))
      .catch(() => live && setQr(''));
    return () => {
      live = false;
    };
  }, [url]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the URL is shown in full below */
    }
  };
  return (
    <Modal title="Scan to enter Tartarus" onClose={onClose} testId="modal-qr">
      <p className={`${MUTED} text-center`}>Hold this up to the room so players can join on their phones.</p>
      <div className="bg-white p-3 rounded-2xl mx-auto w-full max-w-[320px] aspect-square flex items-center justify-center">
        {qr ? <img src={qr} alt="Join QR code" className="w-full h-full object-contain" /> : <span className="text-black font-mono text-xs">Making the QR code…</span>}
      </div>
      <div className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] space-y-2">
        <div data-testid="qr-url" className="text-xs font-mono text-[#c4a45a] break-all">
          {url}
        </div>
        <button onClick={() => void copy()} className={`${BTN} w-full`}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </Modal>
  );
};

export const StandingsModal: React.FC<{ view: AdminViewData; onClose: () => void }> = ({ view, onClose }) => {
  const rows = standings(view);
  const inR3 = view.r3 != null;
  return (
    <Modal title="Live standings (private)" onClose={onClose} testId="modal-standings">
      <p className={MUTED}>Only you see this. Players and the projector are not affected.</p>
      {rows.length === 0 && <div className="py-6 text-center text-xs font-mono text-[#8e95a5]">No crews yet.</div>}
      <div className="space-y-2">
        {rows.map(({ team: t, r3 }, i) => {
          const names = membersOf(view, t.id).map(p => p.name);
          return (
            <div key={t.id} data-testid="standing-row" className="p-3 rounded-xl bg-[#161922] border border-[#2a2e3d] flex items-start gap-3">
              <RankBadge rank={i + 1} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-serif font-bold text-[#f4f0e8] break-words min-w-0">{t.name}</span>
                  <span className="text-[10px] font-mono text-[#c4a45a]">[{t.battleCode}]</span>
                  <MoralBadge status={view.moral[t.id]?.status} />
                </div>
                <div className="text-[11px] text-[#8e95a5] break-words">
                  {names.length} shades{names.length ? `: ${names.join(', ')}` : ''}
                </div>
                {inR3 && r3 && (
                  <div className="text-[11px] font-mono text-[#a9b4c7]">
                    Round 3: {r3.escaped ? `escaped ${medal(r3.escapeRank)}` : `${Math.round(r3.distance)} m`}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <span className="text-sm font-mono font-bold text-[#c4a45a] block">{t.score}</span>
                <span className="text-[10px] font-mono text-[#8e95a5]">PTS</span>
              </div>
            </div>
          );
        })}
      </div>
      <button className={`${BTN_PRIMARY} w-full`} onClick={onClose}>
        Close
      </button>
    </Modal>
  );
};

export const ConfirmModal: React.FC<{ ask: AskOptions; busy: boolean; onClose: () => void }> = ({ ask, busy, onClose }) => (
  <Modal title={ask.title} onClose={onClose} testId="modal-confirm">
    {ask.body && <p className="text-sm text-[#cbd5e1]">{ask.body}</p>}
    <div className="grid grid-cols-2 gap-2">
      <button className={BTN} onClick={onClose}>
        Cancel
      </button>
      <button
        data-testid="confirm-yes"
        disabled={busy}
        className={BTN_PRIMARY}
        onClick={() => {
          onClose();
          ask.onConfirm();
        }}
      >
        {ask.confirmLabel}
      </button>
    </div>
  </Modal>
);

export const ResetModal: React.FC<{ busy: boolean; onClose: () => void; onReset: () => void }> = ({ busy, onClose, onReset }) => {
  const [text, setText] = useState('');
  return (
    <Modal title="Reset the whole game?" onClose={onClose} danger testId="modal-reset">
      <p className="text-sm text-[#cbd5e1]">Deletes every crew, score and round state and returns to the lobby. Players have to join again. This cannot be undone.</p>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Type RESET to confirm" aria-label="Type RESET to confirm" data-testid="reset-confirm" autoComplete="off" className={`${INPUT} w-full`} />
      <div className="grid grid-cols-2 gap-2">
        <button className={BTN} onClick={onClose}>
          Cancel
        </button>
        <button data-testid="reset-game" className={BTN_RED} disabled={busy || text !== 'RESET'} onClick={onReset}>
          <RotateCcw className="w-4 h-4" />
          Reset game
        </button>
      </div>
    </Modal>
  );
};
