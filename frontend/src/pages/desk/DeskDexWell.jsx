// ASK-33 · DeskDexWell — the Desk's Dex well is the DECIDE door.
//
// THE RULE (ASK-33): Decide lives in the Dex well on /inbox, at every width;
// Ask lives in the Dex icon — /brain on desktop, the FAB on the phone. The
// well used to print "today's read" (lib/deskInsight) with a Chase-it pill and
// a Brain shortcut to /brain; that is retired, and the same container now
// takes what the founder decided — spoken or typed, with a file if it helps.
//
// NOTHING NEW UNDERNEATH. The capture machine is useDexCapture on the
// "capture" channel: a spoken decision is HELD and its words come back into
// the field for review (KM-51, ASK-32 1.6). The conversation is
// useDexConversation on the "decide" channel: POST /voice-notes/text, or
// /voice-notes/{id}/submit for a held recording, with the attached file ids
// riding along and read by the pipeline (ASK-32 1.6 / plan 5.4). Those are the
// endpoints the phone's Decide door already used — this is a second entry
// point to one flow, not a second flow.
//
// WHY ITS OWN COMPONENT, AND meterState:false. The Desk renders an ArcGauge,
// six StatTiles and three columns. KM-60: the mic meter samples every 55ms,
// and writing that to React state re-renders whoever owns the hook. So the
// meter stays in a ref — DexWave reads levelsRef on its own animation frame,
// exactly as Layout does for the dock — and the hooks live HERE rather than in
// Desk, so a keystroke in the field or a recording tick re-renders this well
// and nothing else on the page.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Plus, Microphone, Stop, PaperPlaneRight, Paperclip, Keyboard, Waveform, X, Check, WarningCircle, File as FileGlyph,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { captureOutcome, failureReason, readyFor, OUTCOME_COPY } from "../../lib/dexOutcome";
import { proposalCounts, executionSummaryCounts, proposalCreatesText } from "../../lib/decisionProposal";
import { hasPerm } from "../../lib/perms";
import { cn } from "../../lib/utils";
import { useDexCapture } from "../../hooks/useDexCapture";
import { useDexConversation } from "../../hooks/useDexConversation";
import { InsightWell } from "../../components/karma";
import { DexWave } from "../../components/mobile/DexWave";

// A capture lands in several caches at once — the same set Layout refreshes
// after the phone's Dex (refreshAfterCapture).
const REFRESH_KEYS = ["captures-pending", "desk", "inbox", "tasks", "dex-inflight-count"];
// The note walks queued -> transcribing -> structuring; these are its endings.
const ENDINGS = ["done", "nothing", "failed", "slow"];
/* ASK-33 Phase 2 — the stages the expanded well names, in the founder's words.
   "sending" is the POST itself; the rest are the note's own statuses as
   useDexCapture's poll reports them. */
const STEP_LABEL = {
  sending: "Sending it to Dex",
  queued: "Queued",
  transcribing: "Transcribing what you said",
  structuring: "Working out who does what",
};
const isDesktop = () => typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 1024px)").matches;
const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* The floor's circles: the raised .kr-pop the compact well has always used
   (ASK-25), pressed out of the same sheet the well is pressed into. 40px from
   lg, as the old Chase-it pill and Brain circle were; below lg the app's own
   touch rule (index.css, --control-h-sm) lifts every button to 44px (MPWA-01
   §5.1). No pseudo-element hit area on top of that: at 44px it only stuck 2px
   out of the circle and the floor row, which the mobile audit counts as
   horizontal overflow. */
const CIRCLE =
  "kr-pop relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60 disabled:opacity-40";
/* The two circles [+] reveals. Opacity and transform only — both interpolate,
   unlike .kr-pop's shadow pair — and nothing moves under reduced motion. They
   arrive from the [+]: sideways below lg, where they swap into the composer's
   slot, and upward from lg, where they stack above it. */
const POP_ITEM = "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none";
const POP_OPEN = "pointer-events-auto translate-x-0 translate-y-0 scale-100 opacity-100";
const POP_SHUT = "pointer-events-none -translate-x-2 scale-90 opacity-0 lg:translate-x-0 lg:translate-y-2";

/** One attached file: a preview (the image itself, or a file glyph), its name,
 *  and a remove. Removing only drops it from the next note; the upload stays
 *  in files, as it always has. */
function AttachmentChip({ file, onRemove, disabled }) {
  const isImage = !!file.file && (file.type || "").startsWith("image/");
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!isImage) return undefined;
    const url = URL.createObjectURL(file.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [isImage, file.file]);
  return (
    <li className="flex h-7 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-pill bg-white/75 pl-1 pr-0.5 text-xs text-foreground/80 ring-1 ring-inset ring-slate-900/[0.06]">
      {src
        ? <img src={src} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
        : (
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-900/[0.06]">
            <FileGlyph size={11} weight="bold" aria-hidden="true" />
          </span>
        )}
      <span className="min-w-0 truncate" title={file.name}>{file.name}</span>
      {/* 24px drawn; below lg the app's touch rule makes the button itself 44px
          and the row's py-2 gives it that room above and below. */}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-foreground/60 hover:bg-slate-900/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60 disabled:opacity-40"
      >
        <X size={11} weight="bold" aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * @param {React.RefObject} [growToRef]        ASK-33 Phase 2 — the element whose
 *                                             top the expanded well grows to
 *                                             (the Desk's KPI grid)
 * @param {Function}        [onExpandedChange] told true/false as the well becomes
 *                                             and stops being the workspace, so
 *                                             the Desk can fade what it covers
 * @param {Function}        [onReview]         ASK-33 Phase 3 — opens a ready
 *                                             decision in the Desk's existing
 *                                             DecisionDialog
 */
export function DeskDexWell({ className, testid, growToRef, onExpandedChange, onReview }) {
  const { user } = useAuth();
  // The gate every Dex capture surface uses (DexFab, DexSheet, DexCaptureBar).
  const canCapture = user?.role === "owner" || hasPerm(user, "voice_capture");
  const qc = useQueryClient();
  const refresh = useCallback(
    () => REFRESH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    [qc]
  );

  /* KM-51 — the transcript sink. The capture hook is created before the
     conversation it feeds, so a ref filled right below breaks the cycle, as
     it does in Layout. */
  const draftSinkRef = useRef(null);
  const dex = useDexCapture({
    watch: true,
    channel: "capture",
    meterState: false,
    onTranscript: (text, noteId) => draftSinkRef.current?.(text, noteId),
    onCaptured: refresh,
  });
  const chat = useDexConversation({ dex, open: true, channel: "decide", onCommitted: refresh });
  draftSinkRef.current = chat.setDraftFromVoice;

  const [menuOpen, setMenuOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const menuRef = useRef(null);
  const plusRef = useRef(null);
  const fileInputRef = useRef(null);

  // KM-53 — the window between "stop" and the words coming back, as Layout
  // computes it for the dock: the upload and the transcript poll, narrowed to
  // the moment there is genuinely nothing in the field yet.
  const transcribing = !!dex.sending && !chat.draft;
  const showField = chat.mode === "type" || !!chat.draft || transcribing;
  const canSend = !!chat.draft.trim() || chat.pendingFiles.length > 0;
  const intent = dex.recording ? "stop" : canSend ? "send" : "mic";

  /* The decision exists once the note is structured, not when it is sent, so
     the Desk's feeds refresh again at the ending — otherwise the Decisions
     column waits out its 30s poll. */
  const stage = dex.understanding?.status;
  const endingRef = useRef(null);
  useEffect(() => {
    if (!ENDINGS.includes(stage)) return;
    endingRef.current = stage;
    refresh();
  }, [stage, refresh]);

  /* ASK-33 Phase 2 — THE EXPANSION, desktop only.
     On SEND, and only on send, the well becomes the workspace: its pane lifts
     out of the flow, anchored to the well's floor, and grows until its top
     meets the top of the KPI grid beside it (growToRef — that grid is the
     constraint), while the Desk fades the greeting and the score row it passes
     over. The well's own box never changes size, so nothing else on the page
     moves. One long ease-out drives the growth and the fade (index.css
     .kr-dex-grow / .kr-dex-fade), so it settles rather than stops, and
     collapsing is the same move run backwards. Under prefers-reduced-motion the
     transitions are off and the expanded state is simply painted. Below lg none
     of this happens — the phone's expanded surface is the sheet (Phase 4). */
  const wellRef = useRef(null);
  // { from, to, phase }: "start" paints the resting height, "open" is grown,
  // "closing" runs back down and then returns the pane to the flow.
  const [grow, setGrow] = useState(null);
  const [steps, setSteps] = useState([]);
  const [sentText, setSentText] = useState("");
  const [outcome, setOutcome] = useState(null);
  const growing = !!grow;
  const growPhase = grow?.phase;

  const measure = useCallback(() => {
    const well = wellRef.current;
    const grid = growToRef?.current;
    if (!well || !grid) return null;
    const rest = well.offsetHeight;
    const wb = well.getBoundingClientRect();
    const gb = grid.getBoundingClientRect();
    // UI-SCALE: rects are in visual px, offsetHeight in the element's own px.
    const k = wb.height ? rest / wb.height : 1;
    return { from: rest, to: Math.round(rest + Math.max(0, (wb.top - gb.top) * k)) };
  }, [growToRef]);

  const expand = () => {
    if (!isDesktop()) return;
    setSteps([]);
    // Already the workspace (a second capture sent from it): stay open.
    if (grow && grow.phase !== "closing") return;
    const m = measure();
    if (!m) return;
    setGrow({ ...m, phase: prefersReducedMotion() ? "open" : "start" });
  };

  const collapse = useCallback(() => {
    if (prefersReducedMotion()) { setGrow(null); return; }
    setGrow((g) => (g ? { ...g, phase: "closing" } : g));
  }, []);

  // Two frames at the resting height give the transition a value to leave.
  useEffect(() => {
    if (growPhase !== "start") return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setGrow((g) => (g?.phase === "start" ? { ...g, phase: "open" } : g)));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [growPhase]);

  // Back in the flow once the shrink lands — with a fallback, should the
  // transitionend never arrive.
  useEffect(() => {
    if (growPhase !== "closing") return undefined;
    const t = setTimeout(() => setGrow(null), 900);
    return () => clearTimeout(t);
  }, [growPhase]);
  const onPaneTransitionEnd = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "height" && growPhase === "closing") setGrow(null);
  };

  // The grid stays the constraint at any size: re-measure on resize, and let go
  // entirely if the window drops below lg.
  useEffect(() => {
    if (!growing) return undefined;
    const onResize = () => {
      if (!isDesktop()) { setGrow(null); return; }
      const m = measure();
      if (m) setGrow((g) => (g ? { ...g, ...m } : g));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [growing, measure]);

  const expanded = growing && growPhase !== "closing";
  useEffect(() => { onExpandedChange?.(expanded); }, [expanded, onExpandedChange]);

  // The REAL stages the note walks, as the poll reports them — not a spinner.
  useEffect(() => {
    if (!growing || !stage || ENDINGS.includes(stage)) return;
    setSteps((s) => (s.includes(stage) ? s : [...s, stage]));
  }, [growing, stage]);

  const waveState = dex.recording
    ? "listening"
    : (chat.busy || (expanded && !outcome && !ENDINGS.includes(stage))) ? "thinking" : "idle";

  /* ASK-33 Phase 3 — THE ENDINGS (plan 5.1, 5.2). When the note ends while the
     well is the workspace, lib/dexOutcome reads what it came to — a decision
     ready, nothing to decide, or a failure — and the well shows that instead
     of settling back down. It is read here, in the render the ending arrives
     in, because useDexConversation clears the understanding straight after. */
  const growingRef = useRef(false);
  growingRef.current = growing;
  useEffect(() => {
    if (!growing || !ENDINGS.includes(stage)) return;
    setOutcome(captureOutcome(dex.understanding));
  }, [growing, stage, dex.understanding]);
  // Collapsed is done with: the next send starts clean.
  useEffect(() => { if (!growing) setOutcome(null); }, [growing]);

  /* A ready decision is read live, on DecisionDialog's own cache key, so the
     counts follow any edit made in Review — and once it is decided (approved or
     rejected there) the well settles back down. Later leaves it undecided, in
     the Decisions column and at /inbox?decision=<id>, both unchanged. */
  const readyId = outcome?.kind === "ready" ? outcome.decisionId : null;
  const decisionQ = useQuery({
    queryKey: ["decision", readyId],
    queryFn: () => api.get(`/decisions/${readyId}`).then((r) => r.data),
    enabled: !!readyId,
  });
  const readyDecision = decisionQ.data || outcome?.decision || null;
  useEffect(() => {
    if (readyId && readyDecision?.status && readyDecision.status !== "pending_approval") collapse();
  }, [readyId, readyDecision, collapse]);

  /* ASK-33 Phase 1, INTERIM — the well has no outcome screen yet (Phases 2-3
     give it one on desktop, Phase 4 on the phone). Until then Dex's reply to a
     send — the words useDexConversation already writes into its log — is
     shown as a toast rather than dropped. No copy of its own: the text is the
     conversation's. The "reading it now" acknowledgement is skipped because
     it lands while the note is still being followed. */
  const awaitingReplyRef = useRef(false);
  const seenLogRef = useRef(0);
  const understandingRef = useRef(null);
  understandingRef.current = dex.understanding;
  useEffect(() => {
    const fresh = chat.log.slice(seenLogRef.current);
    seenLogRef.current = chat.log.length;
    if (!awaitingReplyRef.current) return;
    const u = understandingRef.current;
    if (u && !ENDINGS.includes(u.status)) return;
    const reply = fresh.filter((m) => m.role === "dex").pop();
    if (!reply) return;
    awaitingReplyRef.current = false;
    /* ASK-33 Phase 3 — on desktop the workspace shows the ending itself (see
       THE ENDINGS), so no toast. The one ending it cannot see is a send that
       never reached the pipeline — ask()'s catch — and that is a failure with
       a reason, shown the same way. */
    if (growingRef.current) {
      if (!endingRef.current) setOutcome({ kind: "failed", ...failureReason(reply.text) });
      return;
    }
    // Below lg the Phase 1 interim stands until the sheet shows endings (Phase 4).
    // No ending recorded means the send itself failed (ask()'s catch).
    if (endingRef.current === "failed" || !endingRef.current) toast.error(reply.text);
    else toast(reply.text);
  }, [chat.log]);

  const send = () => {
    if (!canSend || dex.sending || chat.busy) return;
    awaitingReplyRef.current = true;
    endingRef.current = null;
    setMenuOpen(false);
    setSentText(chat.draft.trim() || chat.pendingFiles.map((f) => f.name).join(", "));
    setOutcome(null);
    expand();
    chat.ask(chat.draft);
  };

  // Outcome C — Retry re-sends the same capture; the workspace thinks again.
  const onRetry = async () => {
    setOutcome(null);
    setSteps([]);
    endingRef.current = null;
    awaitingReplyRef.current = true;
    const ok = await chat.retry();
    if (!ok) {
      awaitingReplyRef.current = false;
      setOutcome((o) => o || { kind: "failed", ...failureReason("") });
    }
  };

  /* The mic circle: stop while recording; send once there is something to
     send (a draft, or a file on its own); otherwise record. */
  const onMic = () => {
    if (dex.recording) { dex.stopRecording(); return; }
    // Upload or transcript still on its way: a tap here would record over the
    // words that are about to come back (KM-51).
    if (dex.sending || chat.busy) return;
    if (canSend) { send(); return; }
    setMenuOpen(false);
    chat.setMode("voice");
    dex.startRecording();
  };

  const onPickFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    setMenuOpen(false);
    if (!f) return;
    setAttaching(true);
    try {
      const res = await chat.attach(f);
      if (res && !res.ok) toast.error(res.message);
    } finally {
      setAttaching(false);
    }
  };

  // The two circles close on a tap anywhere else, and on Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      plusRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // The FAB's glyphs (DexFab), so the two Dex controls speak one language.
  const MicGlyph = intent === "stop" ? Stop : intent === "send" ? PaperPlaneRight : Microphone;
  const micLabel = intent === "stop" ? "Stop recording" : intent === "send" ? "Send to Dex" : "Speak to Dex";
  const typing = chat.mode === "type";

  /* The line under "Dex". Attached files take its place rather than adding a
     row, so the well never changes height. The row's py-2 / -my-2 pair gives
     each remove its 44px target without moving anything around it. */
  /* ASK-33 Phase 3 — files attached for the NEXT capture show while the well
     is the workspace too, now that it stays open on an ending; only the prompt
     line gives way there. */
  const prompt = chat.pendingFiles.length > 0 ? (
    <ul aria-label="Attached files" className="-mb-2 -mt-0.5 flex min-w-0 gap-1.5 overflow-x-auto py-2 [scrollbar-width:none]">
      {chat.pendingFiles.map((f) => (
        <AttachmentChip key={f.id} file={f} onRemove={() => chat.removeFile(f.id)} disabled={chat.busy} />
      ))}
    </ul>
  ) : growing ? null : (
    <p className="mt-1.5 text-sm leading-snug text-foreground/70">
      {canCapture
        ? "Tell Dex what you decided — speak or type."
        : "Ask an owner to turn on Decision Desk capture for you."}
    </p>
  );

  /* ASK-33 Phase 2 — the workspace while the proposal builds: what was sent,
     then each stage the note has reached, the current one live. */
  /* ASK-33 Phase 3 — the three endings, as the workspace shows them. Nothing
     here is a review surface: Review hands off to DecisionDialog, which already
     has the rows, the people and dates to change, what was said and the links
     to what approval creates (ASK-32 Phase 3). */
  const outcomeCounts = readyDecision?.proposal
    ? proposalCounts(readyDecision.proposal)
    : executionSummaryCounts(readyDecision?.execution_summary);
  const quietPill = "kr-pop flex h-10 items-center rounded-pill px-4 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60";
  const inkPill = "flex h-10 items-center rounded-pill bg-kr-ink px-5 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60 disabled:opacity-40";
  const outcomeView = !outcome ? null : outcome.kind === "ready" ? (
    <div data-testid="dex-outcome-ready" className="flex min-h-0 flex-1 flex-col">
      <p data-testid="desk-dex-summary" className="text-[17px] font-semibold leading-snug text-foreground">
        {OUTCOME_COPY.ready(readyFor(readyDecision, user?.id), proposalCreatesText(outcomeCounts))}
      </p>
      {readyDecision?.title && (
        <p className="mt-1 line-clamp-2 text-sm leading-snug text-foreground/70">{readyDecision.title}</p>
      )}
      <dl className="mt-4 grid grid-cols-4 gap-2">
        {[["Tasks", outcomeCounts.tasks], ["People", outcomeCounts.people], ["Approvals", outcomeCounts.approvals], ["Meetings", outcomeCounts.meetings]].map(([label, n]) => (
          <div key={label} className="kr-pop min-w-0 rounded-2xl px-3 py-2.5">
            <dt className="truncate text-[11px] font-medium text-foreground/60">{label}</dt>
            <dd className="mt-1 font-display text-2xl leading-none tabular-nums text-foreground">{n}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <button type="button" data-testid="desk-dex-review" onClick={() => onReview?.(outcome.decisionId)} className={inkPill}>
          Review
        </button>
        <button type="button" onClick={collapse} className={quietPill}>Later</button>
      </div>
    </div>
  ) : outcome.kind === "nothing" ? (
    /* Not an error, and it must not look like one: plain words, one way out. */
    <div data-testid="dex-outcome-nothing" className="flex min-h-0 flex-1 flex-col">
      <p className="text-[17px] font-semibold leading-snug text-foreground">{OUTCOME_COPY.nothing}</p>
      {outcome.answer && (
        <p className="mt-2 whitespace-pre-line break-words text-[15px] leading-relaxed text-foreground/80">{outcome.answer}</p>
      )}
      <div className="mt-auto pt-4">
        <button type="button" onClick={collapse} className={quietPill}>Got it</button>
      </div>
    </div>
  ) : outcome.kind === "failed" ? (
    <div data-testid="dex-outcome-failed" role="alert" className="flex min-h-0 flex-1 flex-col">
      <p className="flex items-start gap-2 text-[17px] font-semibold leading-snug text-foreground">
        <WarningCircle size={20} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-rose-600" />
        {/* The reason is the whole point of this ending: it wraps, never truncates. */}
        <span className="min-w-0 break-words">{outcome.message}</span>
      </p>
      {outcome.href && (
        <Link to={outcome.href} className="mt-2 w-fit text-sm font-medium text-foreground underline underline-offset-4">
          {outcome.linkLabel}
        </Link>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <button type="button" data-testid="dex-outcome-retry" onClick={onRetry} disabled={chat.busy} className={inkPill}>
          Retry
        </button>
        <button type="button" onClick={collapse} className={quietPill}>Not now</button>
      </div>
    </div>
  ) : (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-[15px] leading-relaxed text-foreground/80">{OUTCOME_COPY.slow}</p>
      <div className="mt-auto pt-4">
        <button type="button" onClick={collapse} className={quietPill}>OK</button>
      </div>
    </div>
  );

  const shownSteps = ["sending", ...steps];
  const body = growing ? (
    <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto animate-in fade-in-0 duration-300 motion-reduce:animate-none" aria-live="polite">
      {outcome ? outcomeView : (<>
      {sentText && (
        <p className="line-clamp-3 text-[15px] leading-snug text-foreground">&ldquo;{sentText}&rdquo;</p>
      )}
      <ol className="mt-4 space-y-2.5" aria-label="What Dex is doing">
        {shownSteps.map((s, i) => {
          const current = i === shownSteps.length - 1;
          return (
            <li key={s} className={cn("flex items-center gap-2.5 text-sm", current ? "font-medium text-foreground" : "text-foreground/55")}>
              {current ? (
                <span aria-hidden="true" className="relative grid h-4 w-4 shrink-0 place-items-center">
                  <span className="absolute inset-0 animate-ping rounded-full bg-kr-ink/20 motion-reduce:animate-none" />
                  <span className="h-2 w-2 rounded-full bg-kr-ink" />
                </span>
              ) : (
                <Check size={14} weight="bold" aria-hidden="true" className="shrink-0" />
              )}
              {STEP_LABEL[s] || s}
            </li>
          );
        })}
      </ol>
      </>)}
    </div>
  ) : null;

  const floor = (
    <>
      <div ref={menuRef} className="relative shrink-0">
        {/* THE REVEAL NEVER LEAVES THE WELL, at any width.
            Below lg the well is 150px and the [+] sits ~73px from its top, so
            two 44px circles stacked above it would land on the KPI strip, and
            a row above it would cover the "Dex" label and the prompt. So on a
            phone they SWAP INLINE: they slide into the composer's own slot in
            the floor row (the pill fades while they are out), right where the
            thumb already is, and the mic does not move. From lg they stack
            ABOVE the [+], nearest first — the desktop well leaves ~147px over
            it for 96px of circles, clear of the prompt line.
            Always mounted so they can animate out as well as in; shut, they
            take no taps and no focus. Neither does the box that holds them —
            it is pointer-events-none and only the circles opt back in, while
            open. Shut, that box still has their size: on a phone it sits over
            the composer's left edge and on desktop over the actions an
            outcome puts above the [+], and it swallowed taps on both. */}
        <div
          className="pointer-events-none absolute left-full top-0 z-10 ml-2 flex h-full items-center gap-2 lg:bottom-full lg:left-0 lg:top-auto lg:mb-2 lg:ml-0 lg:h-auto lg:flex-col-reverse"
          aria-hidden={!menuOpen}
        >
          <button
            type="button"
            data-testid="desk-dex-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canCapture || chat.busy}
            tabIndex={menuOpen ? 0 : -1}
            aria-label="Attach a file"
            title="Attach a file"
            className={cn(CIRCLE, POP_ITEM, menuOpen ? POP_OPEN : POP_SHUT)}
          >
            <Paperclip size={17} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="desk-dex-mode"
            onClick={() => { chat.setMode(typing ? "voice" : "type"); setMenuOpen(false); }}
            disabled={!canCapture || dex.recording}
            tabIndex={menuOpen ? 0 : -1}
            aria-label={typing ? "Speak instead" : "Type instead"}
            title={typing ? "Speak instead" : "Type instead"}
            className={cn(CIRCLE, POP_ITEM, menuOpen ? cn(POP_OPEN, "delay-[40ms]") : POP_SHUT)}
          >
            {typing
              ? <Waveform size={17} weight="bold" aria-hidden="true" />
              : <Keyboard size={17} weight="bold" aria-hidden="true" />}
          </button>
        </div>
        <button
          ref={plusRef}
          type="button"
          data-testid="desk-dex-plus"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={!canCapture}
          aria-expanded={menuOpen}
          aria-busy={attaching || undefined}
          aria-label={menuOpen ? "Close" : "Attach a file or switch between speaking and typing"}
          title={menuOpen ? "Close" : "Attach, or type instead"}
          className={cn(CIRCLE, attaching && "animate-pulse")}
        >
          <Plus
            size={17}
            weight="bold"
            aria-hidden="true"
            className={cn("transition-transform duration-200 motion-reduce:transition-none", menuOpen && "rotate-45")}
          />
        </button>
        {/* Any file type — the pipeline reads what it can (plan 5.4). */}
        <input ref={fileInputRef} type="file" className="hidden" tabIndex={-1} onChange={onPickFile} />
      </div>

      {/* The old "Chase it" pill, stretched to the row. KM-51 / KM-53, as the
          dock: the field shows in type mode, AND whenever there is a draft
          (a recording's words come back here to be read and edited before
          anything is sent), AND while transcribing — read-only then, because
          the words arrive as a setDraft that would wipe anything typed in the
          gap. Otherwise the wave. */}
      <div
        data-testid="desk-dex-composer"
        data-mode={showField ? "type" : "voice"}
        /* min-h from the same token that lifts the circles and the field to
           44px below lg (index.css --control-h-sm), so the pill never sits
           shorter than its neighbours on a phone. */
        className={cn(
          "kr-pop flex h-10 min-h-[var(--control-h-sm)] min-w-0 flex-1 items-center overflow-hidden rounded-pill focus-within:ring-2 focus-within:ring-kr-ink/60",
          "transition-opacity duration-200 motion-reduce:transition-none",
          // Below lg the [+] circles swap into this slot; the pill steps back.
          menuOpen && "pointer-events-none opacity-0 lg:pointer-events-auto lg:opacity-100"
        )}
      >
        {showField ? (
          <input
            // Mounts on switching to type, so the keyboard comes up with it —
            // but not for a transcript arriving, which is only to be watched.
            autoFocus={typing}
            value={chat.draft}
            readOnly={transcribing}
            disabled={!canCapture}
            onChange={(e) => chat.setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
            // Short enough to fit whole at 360px, where the field is ~150px of text.
            placeholder={transcribing ? "Transcribing…" : "Type a decision…"}
            aria-label="Tell Dex what you decided"
            className={cn(
              "h-full min-w-0 flex-1 bg-transparent px-4 text-sm text-foreground focus:outline-none",
              // A status being waited on should not wear the grey of a hint.
              transcribing ? "animate-pulse placeholder:text-foreground/75" : "placeholder:text-foreground/45"
            )}
          />
        ) : (
          <div className="h-full min-w-0 flex-1 px-4 py-1.5">
            {waveState !== "idle" ? (
              /* tone="ink" — KM-62's light-surface ribbons; levelsRef, not
                 levels, so the meter never renders the well (KM-60). */
              <DexWave tone="ink" state={waveState} levelsRef={dex.levelsRef} />
            ) : (
              /* AT REST THE WAVE IS STILL. DexWave redraws its ribbons on every
                 animation frame for as long as it is mounted. That is right for
                 the dock, which is only open while Dex is in use, and wrong for
                 a well that sits on the Desk all day: a dashboard left open ran
                 a frame loop for as long as it stayed open, and the endless path
                 writes kept the mobile audit waiting for a page that never went
                 still. So the ribbons mount only while there is something to
                 show (listening, thinking); at rest this is DexWave's own ink
                 hairline, drawn once. */
              <svg viewBox="0 0 240 44" preserveAspectRatio="none" aria-hidden="true" className="block h-full w-full">
                <line x1="0" y1="22" x2="240" y2="22" stroke="hsl(230 15% 30% / .38)" strokeWidth="0.6" opacity="0.35" />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* The Brain circle, now the microphone. */}
      <button
        type="button"
        data-testid="desk-dex-mic"
        data-intent={intent}
        onClick={onMic}
        disabled={!canCapture || (!dex.recording && (dex.sending || chat.busy))}
        aria-label={micLabel}
        title={micLabel}
        className={cn(CIRCLE, dex.recording && "bg-kr-accent text-white")}
      >
        <MicGlyph size={18} weight={intent === "stop" ? "fill" : "bold"} aria-hidden="true" />
      </button>

      <span className="sr-only" aria-live="polite">
        {dex.recording ? "Recording" : transcribing ? "Transcribing" : chat.busy ? "Sending to Dex" : ""}
      </span>
    </>
  );

  return (
    <InsightWell
      compact
      label="Dex"
      prompt={prompt}
      body={body}
      floor={floor}
      className={className}
      testid={testid}
      expanded={expanded}
      wellRef={wellRef}
      paneClassName={grow && growPhase !== "start" ? "kr-dex-grow" : undefined}
      paneStyle={grow
        ? { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 10, height: growPhase === "open" ? grow.to : grow.from }
        : undefined}
      onPaneTransitionEnd={onPaneTransitionEnd}
    />
  );
}

export default DeskDexWell;
