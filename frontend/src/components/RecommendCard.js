// "How likely are you to recommend DecisionOS?" (admin console v2 P4, 2026-10-23).
// One question, asked at most once every 90 days and never in a workspace's
// first two weeks. It shows only when the platform admin has turned on the
// global flag `nps` -- off by default, so most people never see it. Closing it
// counts as an answer, so it doesn't come back tomorrow.
import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import api from "../lib/api";
import { DRAWER_CARD, DRAWER_FIELD, INK_PILL, GLASS_ICON_BTN } from "./neuglass/glass";

const ASKED_KEY = "dos_nps_checked_at";

export default function RecommendCard() {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Ask the server at most once a day per device; the answer rarely changes.
    try {
      const last = Number(localStorage.getItem(ASKED_KEY) || 0);
      if (Date.now() - last < 24 * 3600 * 1000) return undefined;
    } catch { /* storage blocked: just ask */ }
    let alive = true;
    const t = setTimeout(() => {
      api.get("/nps/ask").then((r) => {
        try { localStorage.setItem(ASKED_KEY, String(Date.now())); } catch { /* ignore */ }
        if (alive && r.data?.ask) setOpen(true);
      }).catch(() => {});
    }, 8000); // let the page settle first; this is never the first thing anyone sees
    return () => { alive = false; clearTimeout(t); };
  }, []);

  const send = async (body) => {
    setBusy(true);
    try { await api.post("/nps", body); } catch { /* never in the way */ }
    setBusy(false);
  };
  const close = () => { if (!done) send({ dismissed: true }); setOpen(false); };
  const submit = async (e) => {
    e.preventDefault();
    if (score == null) return;
    await send({ score, comment });
    setDone(true);
    setTimeout(() => setOpen(false), 2200);
  };

  if (!open) return null;
  return (
    <div role="dialog" aria-labelledby="nps-q" data-testid="recommend-card"
      className={`fixed inset-x-3 bottom-[calc(7.75rem+env(safe-area-inset-bottom))] z-40 p-5 sm:left-auto sm:right-6 sm:w-[25rem] lg:bottom-6 ${DRAWER_CARD} bg-white/90`}>
      <button type="button" onClick={close} aria-label="Close" className={`absolute right-3 top-3 !h-9 !w-9 ${GLASS_ICON_BTN}`}>
        <X size={16} />
      </button>
      {done ? (
        <p className="pr-10 text-[15px] font-medium text-slate-900">Thank you — that helps us decide what to build next.</p>
      ) : (
        <form onSubmit={submit}>
          <p id="nps-q" className="pr-10 text-[15px] font-semibold leading-snug text-slate-900">
            How likely are you to recommend DecisionOS to another business owner?
          </p>
          <div className="mt-4 grid grid-cols-11 gap-1" role="radiogroup" aria-label="0 is not at all likely, 10 is very likely">
            {Array.from({ length: 11 }, (_, n) => (
              <button key={n} type="button" role="radio" aria-checked={score === n} onClick={() => setScore(n)}
                data-testid={`recommend-${n}`}
                className={`h-9 rounded-xl text-sm font-medium tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 ${
                  score === n ? "bg-slate-900 text-white" : "bg-slate-500/[0.08] text-slate-700 hover:bg-slate-500/[0.16]"}`}>
                {n}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-slate-500"><span>Not likely</span><span>Very likely</span></div>
          {score != null && (
            <>
              <label htmlFor="nps-why" className="mt-4 block text-[13px] font-medium text-slate-700">
                {score >= 9 ? "What do you like most?" : score >= 7 ? "What would make it a 10?" : "What should we fix first?"}
                <span className="font-normal text-slate-500"> (optional)</span>
              </label>
              <textarea id="nps-why" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000}
                className={`mt-1.5 resize-none !py-2.5 !text-sm ${DRAWER_FIELD}`} />
              <button type="submit" disabled={busy} className={`mt-3 h-11 w-full rounded-pill text-sm font-semibold disabled:opacity-50 ${INK_PILL}`}>
                Send
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
