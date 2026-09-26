// ASK-33 · DeskDexWell — the Desk's Dex well is the DECIDE door.
//
// THE RULE (ASK-33): Decide lives in the Dex well on /inbox, at every width;
// Ask lives in the Dex icon — /brain on desktop, the FAB on the phone. The
// well used to print "today's read" (lib/deskInsight) with a Chase-it pill and
// a Brain shortcut to /brain; that is retired, and the same container now
// takes what the founder decided — spoken or typed, with a file if it helps.
//
// NOTHING NEW UNDERNEATH. The capture machine is useDexCapture on the
// "capture" channel: a spoken decision is HELD and its words come back for
// review (KM-51, ASK-32 1.6). The conversation is useDexConversation on the
// "decide" channel: POST /voice-notes/text, or /voice-notes/{id}/submit for a
// held recording, with the attached file ids riding along and read by the
// pipeline (ASK-32 1.6 / plan 5.4). Those are the endpoints the phone's Decide
// door already used — this is a second entry point to one flow, not a second
// flow.
//
// PILOT-2 A — THE WELL IS THE DOOR AGAIN, AND ONLY THE DOOR. The pilot client:
// a long spoken decision was poured into the well's two-line field, where it
// could not be read or edited, and the ending that followed was a counts-only
// screen that made him press Review to see anything real. So the capture now
// happens in ONE pop-up (DexCapturePopup): what was said, Dex reading it, and
// what Dex made — the last of those being DecisionDialog's own breakdown with
// Approve, Save as draft and Reject. What is left here is the door: the ripple
// and its mic, the paperclip, the keyboard and send, and the kept-draft note.
// The workspace the well used to become, its desktop growth to the top of the
// KPI grid (ASK-33 Phase 2 / ASK-35 G2), the fade it ran over the hero, the
// counts screen and ASK-47's pinned action row inside a scrolling ending are
// all gone with it: they existed only to make room for work that has moved
// into the pop-up.
//
// WHY ITS OWN COMPONENT, AND meterState:false. The Desk renders an ArcGauge,
// six StatTiles and three columns. KM-60: the mic meter samples every 55ms,
// and writing that to React state re-renders whoever owns the hook. So the
// meter stays in a ref — the ripple reads levelsRef on its own animation frame
// — and the hooks live HERE rather than in Desk, so a keystroke in the field or
// a recording tick re-renders this well (and its pop-up) and nothing else.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PaperPlaneRight, Paperclip, X, Check, File as FileGlyph, Keyboard } from "@phosphor-icons/react";
import { useAuth } from "../../context/AuthContext";
import { captureOutcome, failureReason, isReading, OUTCOME_COPY } from "../../lib/dexOutcome";
import { toastDexOutcome } from "../../lib/dexOutcomeToast";
import { hasPerm } from "../../lib/perms";
import { cn } from "../../lib/utils";
import { useDexCapture } from "../../hooks/useDexCapture";
import { useDexConversation } from "../../hooks/useDexConversation";
import { InsightWell } from "../../components/karma";
// ASK-47 — the ripple the founder signed off in the lab, now the mic.
import { VoiceRipple, DESK_RIPPLE } from "../../components/karma/VoiceRipple";
import { DexWave } from "../../components/mobile/DexWave";
import { DraftNote } from "../../components/karma/DraftNote";
import { DexCapturePopup } from "./DexCapturePopup";

// A capture lands in several caches at once — the same set Layout refreshes
// after the phone's Dex (refreshAfterCapture).
const REFRESH_KEYS = ["captures-pending", "desk", "inbox", "tasks", "dex-inflight-count"];
// The note walks queued -> transcribing -> structuring; these are its endings.
const ENDINGS = ["done", "nothing", "failed", "slow"];
// The pop-up's step for each ending (lib/dexOutcome's kinds).
const ENDING_STEP = { ready: "made", nothing: "nothing", failed: "failed", slow: "slow" };
// What the well says about a capture whose pop-up has been closed.
const STATUS_LINE = {
  reading: "Dex is reading it",
  ready: "Decision ready",
  nothing: "Dex answered",
  failed: "That didn't go through",
  slow: "Still working on it",
};

/* The floor's circles: the raised .kr-pop the compact well has always used
   (ASK-25), pressed out of the same sheet the well is pressed into. 40px from
   lg, as the old Chase-it pill and Brain circle were; below lg the app's own
   touch rule (index.css, --control-h-sm) lifts every button to 44px (MPWA-01
   §5.1). */
const CIRCLE =
  "kr-pop relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60 disabled:opacity-40";

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
 * @param {boolean}  [phone]    the phone's arrangement (ASK-47): the ripple is
 *                              the centre of a near-square well
 * @param {Function} [onLater]  ASK-36 2 / PILOT-2 B — told the decision id when
 *                              a ready one is saved as a draft
 * @param {Function} [onReview] opens a decision that is NOT this well's capture
 *                              in the Desk's DecisionDialog (a late toast for an
 *                              older one)
 */
export function DeskDexWell({ className, testid, phone = false, onReview, onLater }) {
  const { user } = useAuth();
  // The gate every Dex capture surface uses (DexFab, DexCaptureBar).
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
  // PILOT-1 A — what is typed here survives leaving the Desk and a reload. And
  // PILOT-2 A — the transcript being edited in the pop-up IS this draft, so it
  // survives the same way.
  const chat = useDexConversation({ dex, open: true, channel: "decide", onCommitted: refresh, userId: user?.id, draftName: "dex-well" });
  // For toasts and handlers, which act long after the render that made them.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  /* PILOT-2 A — WHERE THE CAPTURE IS.
       idle     nothing under way; the well is the door
       said     step 1: a recording's words, read and edited in the pop-up
       reading  step 2: sent, and Dex is reading it
       ended    step 3, or the ending that is not a decision
     `popupOpen` is separate on purpose: closing the pop-up is not the same as
     stopping the capture. Close it while Dex reads and the note carries on; the
     well says where it got to and opens it again. */
  const [phase, setPhase] = useState("idle");
  const [popupOpen, setPopupOpen] = useState(false);
  const popupOpenRef = useRef(false);
  popupOpenRef.current = popupOpen;
  const [steps, setSteps] = useState([]);
  const [sentText, setSentText] = useState("");
  const [outcome, setOutcome] = useState(null);
  const outcomeRef = useRef(null);
  outcomeRef.current = outcome;
  // A Discard pressed while the words were still on their way: drop them when
  // they land rather than filling a draft the founder just threw away.
  const ignoreTranscriptRef = useRef(false);

  /* THE PILL IS FOR TYPING. "The two-line pill never holds a transcript
     again": a recording's words go to the pop-up, and a draft kept from before
     is offered there too (the kept-draft note's Open). `pillDraft` is true only
     while the words in the draft were typed into the pill in this visit. */
  const [pillDraft, setPillDraft] = useState(false);
  /* Between "stop" and the upload starting, `dex.sending` is not yet true, so
     step 1 would say for a moment that nothing came through. `waitingWords`
     covers that gap: set on stop, cleared when the words land or when the
     capture hook gives up on them (its own toast says why). */
  const [waitingWords, setWaitingWords] = useState(false);
  draftSinkRef.current = (text, noteId) => {
    setWaitingWords(false);
    if (ignoreTranscriptRef.current) { ignoreTranscriptRef.current = false; return; }
    setPillDraft(false);
    chat.setDraftFromVoice(text, noteId);
  };
  const wasSendingRef = useRef(false);
  useEffect(() => {
    if (wasSendingRef.current && !dex.sending) setWaitingWords(false);
    wasSendingRef.current = !!dex.sending;
  }, [dex.sending]);

  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef(null);

  // KM-53 — the window between "stop" and the words coming back.
  const transcribing = (!!dex.sending || waitingWords) && !chat.draft;
  const recording = !!dex.recording;

  /* ASK-47 — VOICE FIRST, AND THE KEYBOARD IS A DOOR. The field is not on
     screen until there is something to type: the keyboard circle opens it, and
     leaving it empty closes it again (J1-13: on blur, never on a clock). */
  const [typing, setTyping] = useState(false);
  const fieldOpen = typing || (pillDraft && !!chat.draft);

  /* ASK-33 Phase 5 — THE FIELD GROWS TO TWO LINES, no further (it holds what
     is TYPED; a long spoken capture is read in the pop-up). Measured from the
     field's own line height and padding. */
  const fieldRef = useRef(null);
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = "auto";
    const max = Math.round(line * 2 + pad);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [chat.draft, recording, fieldOpen]);

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

  // The REAL stages the note walks, as the poll reports them — not a spinner.
  useEffect(() => {
    if (phase !== "reading" || !stage || ENDINGS.includes(stage)) return;
    setSteps((s) => (s.includes(stage) ? s : [...s, stage]));
  }, [phase, stage]);

  /* ASK-33 Phase 3 — THE ENDINGS. When the note this well sent ends,
     lib/dexOutcome reads what it came to — a decision ready, nothing to decide,
     or a failure — and the pop-up's last step is that. It is read here, in the
     render the ending arrives in, because useDexConversation clears the
     understanding straight after. Only while this well is READING a capture:
     the poll re-populates that state after an ending, and anything keyed off it
     alone would re-open itself once dismissed (KM-23's ghost card). */
  useEffect(() => {
    if (phase !== "reading" || !ENDINGS.includes(stage)) return;
    const o = captureOutcome(dex.understanding);
    if (!o) return;
    setOutcome(o);
    setPhase("ended");
  }, [phase, stage, dex.understanding]);

  /* ASK-33 Phase 1 — THE LATE ENDING. The pop-up was closed before the note
     finished, so the answer still has to reach the founder rather than being
     dropped: the sheet's own late toasts (lib/dexOutcomeToast), whose Review
     opens the pop-up again at step 3. The one ending the poll cannot see is a
     send that never reached the pipeline (ask()'s catch) — a failure with a
     reason, shown the same way. The "reading it now" acknowledgement is skipped
     because it lands while the note is still being followed. */
  const awaitingReplyRef = useRef(false);
  const seenLogRef = useRef(0);
  const understandingRef = useRef(null);
  understandingRef.current = dex.understanding;
  // A kept capture's Retry, from its failure notice: the ending is reported the
  // same way, and the pop-up can be opened on it.
  const retryKept = async (o) => {
    endingRef.current = null;
    awaitingReplyRef.current = true;
    setOutcome(null);
    setSteps([]);
    setPhase("reading");
    const ok = await chatRef.current.retry(o.retry);
    if (!ok) awaitingReplyRef.current = false;
  };
  const toastEndingRef = useRef(null);
  toastEndingRef.current = (message) => toastDexOutcome(message, {
    onReview: (id) => {
      if (outcomeRef.current?.decisionId === id) { setPopupOpen(true); return; }
      onReview?.(id);
    },
    onRetry: retryKept,
    canRetry: () => !!chatRef.current.canRetry,
  });
  useEffect(() => {
    const fresh = chat.log.slice(seenLogRef.current);
    seenLogRef.current = chat.log.length;
    if (!awaitingReplyRef.current) return;
    const u = understandingRef.current;
    if (u && !ENDINGS.includes(u.status)) return;
    const reply = fresh.filter((m) => m.role === "dex" && !m.reading).pop();
    if (!reply) return;
    awaitingReplyRef.current = false;
    if (!endingRef.current) {
      setOutcome({ kind: "failed", ...failureReason(reply.text) });
      setPhase("ended");
    }
    if (!popupOpenRef.current) toastEndingRef.current(reply);
  }, [chat.log]);

  /* ASK-33.1 — the capture being read may still be the ASK SHEET's, and this
     well cannot see that hook. Layout answers on an event. */
  const sheetReading = () => {
    const ev = new CustomEvent("dos:dex-state", { detail: { reading: false } });
    window.dispatchEvent(ev);
    return !!ev.detail.reading;
  };
  const stillReading = () => isReading(dex) || sheetReading();

  /* THE ONE SEND, for both ways in: the pill's Enter or send arrow (a typed
     capture, which skips step 1 — the founder has already read what they
     typed), and the pop-up's Next (a spoken one, read and edited first). Either
     way the pop-up is at step 2 as the words leave. */
  const send = () => {
    const c = chatRef.current;
    if (!(c.draft.trim() || c.pendingFiles.length > 0) || dex.sending || c.busy) return;
    /* ASK-33.1 — ONE CAPTURE AT A TIME. A second send while Dex is still reading
       the first retires that poll: the decision would still land in the
       Decisions column, but a FAILURE would have nowhere to land (plan 5.2).
       Refused in the founder's words, and released the moment the first ends. */
    if (stillReading()) { toast(OUTCOME_COPY.stillReading); return; }
    endingRef.current = null;
    awaitingReplyRef.current = true;
    setSentText(c.draft.trim() || c.pendingFiles.map((f) => f.name).join(", "));
    setOutcome(null);
    setSteps([]);
    setPhase("reading");
    setPopupOpen(true);
    setPillDraft(false);
    setTyping(false);
    c.ask(c.draft);
  };

  // Step 1 opens the moment a recording stops, so the words have a place to
  // land that is big enough to read them in (KM-51 holds the recording).
  const openSaid = () => {
    ignoreTranscriptRef.current = false;
    setPillDraft(false);
    setTyping(false);
    setOutcome(null);
    setPhase("said");
    setPopupOpen(true);
  };

  // Step 1's Discard: the words, the held recording and the files that were
  // going with them. Nothing was sent, so nothing else changes.
  const discard = () => {
    const c = chatRef.current;
    if (transcribing) ignoreTranscriptRef.current = true;
    setWaitingWords(false);
    c.setDraftFromVoice("", null);
    c.draftKept?.discard?.();
    c.pendingFiles.forEach((f) => c.removeFile(f.id));
    setPhase("idle");
    setPopupOpen(false);
  };

  /* Closing is never cancelling. Step 1: the words stay, as a kept draft the
     well offers back. Step 2: the note keeps being read, and the well says so.
     An ending: the capture is finished — its decision waits in the Decisions
     column, and this well goes back to being the door. */
  const closePopup = () => {
    setPopupOpen(false);
    if (phase === "said") setPhase("idle");
    if (phase === "ended") { setPhase("idle"); setOutcome(null); }
  };

  // Outcome C — Retry re-sends the same capture; Dex reads it again.
  const onRetry = async () => {
    setOutcome(null);
    setSteps([]);
    setPhase("reading");
    endingRef.current = null;
    awaitingReplyRef.current = true;
    const ok = await chatRef.current.retry();
    if (!ok) {
      awaitingReplyRef.current = false;
      setOutcome((o) => o || { kind: "failed", ...failureReason("") });
      setPhase("ended");
    }
  };

  // PILOT-2 B — Save as draft: marked in the Decisions column, and the pop-up
  // is done. The decision itself was saved on the server when Dex made it.
  const saveDraft = (id) => {
    onLater?.(id);
    toast("Saved as a draft", { description: "It's in Decisions on the Desk, marked Draft." });
    setPopupOpen(false);
    setPhase("idle");
    setOutcome(null);
  };

  /* THE MIC — the ripple's hub. It stops a recording (and opens step 1 for the
     words); it records; and when words are already waiting it does the thing
     they are waiting for: typed ones in the pill are sent, kept ones are
     opened in the pop-up to be read first. */
  const onMic = () => {
    if (dex.recording) { setWaitingWords(true); dex.stopRecording(); openSaid(); return; }
    // Upload or transcript still on its way: a tap here would record over the
    // words that are about to come back (KM-51).
    if (dex.sending || chat.busy) return;
    if (chat.draft.trim()) {
      if (fieldOpen) send(); else openSaid();
      return;
    }
    /* ASK-33.1 — and one at a time for recording too: the transcript poll
       shares the capture hook's one follow, so a new recording while Dex reads
       the last note would leave that note's ending unreported. */
    if (stillReading()) { toast(OUTCOME_COPY.stillReading); return; }
    dex.startRecording();
  };

  const onPickFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setAttaching(true);
    try {
      const res = await chat.attach(f);
      if (res && !res.ok) toast.error(res.message);
    } finally {
      setAttaching(false);
    }
  };

  const kept = !!chat.draft.trim() && !fieldOpen;
  const micLabel = recording ? "Stop recording"
    : chat.draft.trim() ? (fieldOpen ? "Send to Dex" : "Open what you said")
    : "Speak to Dex";

  /* ASK-47 — WHAT THE RIPPLE READS. useDexCapture keeps a rolling window of
     samples (`levelsRef`); the ripple wants one number, so it takes the newest.
     A ref read on the ripple's own frame, which is why this costs the well no
     renders at all. */
  const readLevel = useCallback(() => {
    const bars = dex.levelsRef?.current;
    return Array.isArray(bars) ? bars[bars.length - 1] || 0 : 0;
  }, [dex.levelsRef]);

  /* 2026-09-21 · THE DESKTOP WELL'S RIPPLE RUNS INWARD. The stage is the whole
     pane and the waves start at its inner wall; the mic sits in the middle of
     the space above the floor. Measured in the pane's own pixels. */
  const holeRef = useRef(null);
  const [hub, setHub] = useState(null);
  useEffect(() => {
    if (phone) return undefined;
    const el = holeRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const fit = () => {
      const h = el.offsetHeight;
      const next = {
        x: Math.round(el.offsetLeft + el.offsetWidth / 2),
        y: Math.round(el.offsetTop + h / 2),
        // A 44px floor for the target; room above and below it, never cramped.
        d: Math.max(48, Math.min(68, Math.round(h - 26))),
      };
      setHub((cur) => (cur && cur.x === next.x && cur.y === next.y && cur.d === next.d ? cur : next));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    fit();
    return () => ro.disconnect();
  });
  // And on a phone the well measures itself so the ripple fills what the page
  // gave it, whatever phone that turns out to be.
  const wellRef = useRef(null);
  const [rippleSize, setRippleSize] = useState(220);
  useEffect(() => {
    if (!phone) return undefined;
    const el = wellRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const fit = () => {
      const room = Math.min(el.offsetWidth - 40, el.offsetHeight - 128);
      setRippleSize((s) => {
        // Never bigger than 300, never smaller than a 44px hub can live in.
        const next = Math.max(88, Math.min(300, Math.round(room)));
        return Math.abs(next - s) > 2 ? next : s;
      });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [phone]);

  const rippleDisabled = !canCapture || (!recording && (dex.sending || chat.busy));

  /* The top of the pane: what is going to be sent, what was kept, and — once
     the pop-up has been closed on a capture — where that capture got to. */
  const attachments = chat.pendingFiles.length > 0 ? (
    <ul aria-label="Attached files" className="-mb-2 -mt-0.5 flex min-w-0 gap-touch-gap overflow-x-auto py-2 [scrollbar-width:none]">
      {chat.pendingFiles.map((f) => (
        <AttachmentChip key={f.id} file={f} onRemove={() => chat.removeFile(f.id)} disabled={chat.busy} />
      ))}
    </ul>
  ) : null;
  /* J4-03 (JOURNEY-1) — THE WELL SAYS IT KEPT SOMETHING, and PILOT-2 A — it
     offers it back where it can be read: a kept capture opens in the pop-up's
     first step, never in the two-line pill. It is not a decision until sent. */
  const keptDraft = kept && !popupOpen ? (
    <DraftNote testid="dex-well-draft" className="mb-1.5"
      label={chat.draftKept?.restored ? "Kept from before — not sent to Dex yet" : "What you said is kept — not sent to Dex yet"}
      onOpen={openSaid}
      onDiscard={discard} />
  ) : null;
  const statusKey = phase === "reading" ? "reading" : phase === "ended" ? outcome?.kind : null;
  const capturePill = !popupOpen && statusKey ? (
    <button
      type="button"
      onClick={() => setPopupOpen(true)}
      data-testid="dex-well-status"
      data-status={statusKey}
      className="kr-pop mb-1.5 flex min-h-11 w-fit max-w-full items-center gap-2 rounded-pill px-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60"
    >
      {statusKey === "reading" ? (
        <span aria-hidden="true" className="relative grid h-3 w-3 shrink-0 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-kr-ink/25 motion-reduce:animate-none" />
          <span className="h-1.5 w-1.5 rounded-full bg-kr-ink" />
        </span>
      ) : (
        <Check size={14} weight="bold" aria-hidden="true" className="shrink-0" />
      )}
      <span className="min-w-0 truncate">{STATUS_LINE[statusKey] || STATUS_LINE.reading}</span>
      <span className="shrink-0 font-medium underline underline-offset-4">Open</span>
    </button>
  ) : null;
  const top = (capturePill || keptDraft || attachments)
    ? <div className="relative z-10">{capturePill}{keptDraft}{attachments}</div>
    : null;

  /* THE RIPPLE IS THE INVITATION, on both surfaces. It runs off the capture the
     page already owns — useDexCapture's meter through `readLevel` — rather than
     opening a second stream onto the same microphone. At rest it breathes;
     while it is listening it answers the room. */
  const body = phone ? (
    <div className="grid min-h-0 flex-1 place-items-center" data-testid="desk-dex-ripple">
      <VoiceRipple
        size={rippleSize}
        // ASK-48 — the founder's own settings, dialled in the lab.
        config={DESK_RIPPLE}
        readLevel={readLevel}
        listening={recording}
        onPress={onMic}
        disabled={rippleDisabled}
        label={micLabel}
      />
    </div>
  ) : (
    /* The space the mic is centred in. The ripple itself is positioned against
       the pane, so it covers the whole well and its waves start at the well's
       own wall. */
    <div ref={holeRef} className="min-h-0 flex-1" data-testid="desk-dex-ripple">
      {hub && (
        <VoiceRipple
          mode="in"
          hubPx={hub.d}
          hubAt={hub}
          config={DESK_RIPPLE}
          // Quieter at rest than the phone's: the wave covers the whole well.
          idle={0.1}
          readLevel={readLevel}
          listening={recording}
          onPress={onMic}
          disabled={rippleDisabled}
          label={micLabel}
        />
      )}
    </div>
  );

  /* ASK-48 — THE TITLE IS IN THE FLOOR, centred between the two circles, on
     every size (2026-09-21). */
  const floorTitle = (
    <div className="pointer-events-none min-w-0 flex-1 px-2 text-center">
      <span className="block text-xs font-semibold tracking-wide text-foreground/75">Dex</span>
      <span className="mt-0.5 block truncate text-[13px] leading-snug text-foreground/70">
        {!canCapture ? "Ask an owner to turn on capture."
          : transcribing ? "Transcribing what you said…"
          : "Tell Dex what you decided."}
      </span>
    </div>
  );

  const floor = (
    <>
      {/* ASK-33.2 — attach · field · keyboard. Attach is one tap on its own
          circle; any file type — the pipeline reads what it can (plan 5.4). */}
      <button
        type="button"
        data-testid="desk-dex-attach"
        data-dex-floor="1"
        onClick={() => fileInputRef.current?.click()}
        disabled={!canCapture || chat.busy}
        aria-busy={attaching || undefined}
        aria-label="Attach a file"
        title="Attach a file"
        className={cn(CIRCLE, attaching && "animate-pulse")}
      >
        <Paperclip size={17} weight="bold" aria-hidden="true" />
      </button>
      <input ref={fileInputRef} type="file" className="hidden" tabIndex={-1} onChange={onPickFile} />

      {/* THE FIELD IS SUNKEN — .nm-field, the app's own field with its own
          focus ring (ASK-34 items 1 and 2). NOT RENDERED until there is
          something to type (ASK-47); a recording started while it is open
          draws its wave in it (KM-51), and gives way to step 1 when it stops. */}
      {fieldOpen ? (
      <div
        data-testid="desk-dex-composer"
        data-mode={recording ? "voice" : "type"}
        className={cn(
          "nm-field flex min-h-[var(--control-h-sm)] min-w-0 flex-1 items-center overflow-hidden rounded-pill",
          recording ? "h-10" : "h-auto"
        )}
      >
        {!recording ? (
          <textarea
            ref={fieldRef}
            rows={1}
            value={chat.draft}
            disabled={!canCapture}
            onChange={(e) => { setPillDraft(true); chat.setDraft(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); send(); }
              if (e.key === "Escape" && !chat.draft.trim()) { e.preventDefault(); setTyping(false); }
            }}
            /* A tap on attach or on the keyboard circle blurs the field on its
               way to a button in this same row, so look where the focus landed
               — and at what is in the field NOW — before closing anything. */
            onBlur={() => {
              if (chat.draft.trim()) return;
              setTimeout(() => {
                if (document.activeElement?.getAttribute?.("data-dex-floor") === "1") return;
                if (fieldRef.current?.value?.trim()) return;
                setTyping(false);
              }, 120);
            }}
            placeholder="Type a decision…"
            aria-label="Tell Dex what you decided"
            className="block min-w-0 flex-1 resize-none bg-transparent px-4 py-2.5 text-sm leading-5 text-foreground placeholder:text-foreground/45 focus:outline-none max-lg:leading-6 [scrollbar-width:none]"
          />
        ) : (
          /* tone="ink" — KM-62's light-surface ribbons; levelsRef, not levels,
             so the meter never renders the well (KM-60). */
          <div className="h-full min-w-0 flex-1 px-4 py-1.5">
            <DexWave tone="ink" state="listening" levelsRef={dex.levelsRef} />
          </div>
        )}
      </div>
      ) : floorTitle}

      {/* The other way in: a keyboard, which opens the field — and once there
          is something typed in it, the send arrow. A kept capture opens in the
          pop-up instead of the pill. */}
      <button
        type="button"
        data-testid="desk-dex-keyboard"
        data-dex-floor="1"
        data-intent={fieldOpen && chat.draft.trim() ? "send" : "type"}
        onClick={() => {
          if (fieldOpen && chat.draft.trim()) { send(); return; }
          if (kept) { openSaid(); return; }
          setTyping(true);
          requestAnimationFrame(() => fieldRef.current?.focus());
        }}
        disabled={!canCapture || chat.busy || recording}
        aria-label={fieldOpen && chat.draft.trim() ? "Send to Dex" : "Type instead"}
        title={fieldOpen && chat.draft.trim() ? "Send to Dex" : "Type instead"}
        className={CIRCLE}
      >
        {fieldOpen && chat.draft.trim()
          ? <PaperPlaneRight size={17} weight="bold" aria-hidden="true" />
          : <Keyboard size={18} weight="bold" aria-hidden="true" />}
      </button>

      <span className="sr-only" aria-live="polite">
        {recording ? "Recording" : transcribing ? "Transcribing" : chat.busy ? "Sending to Dex" : ""}
      </span>
    </>
  );

  const step = phase === "said" ? "said"
    : phase === "reading" ? "reading"
    : phase === "ended" ? (ENDING_STEP[outcome?.kind] || "slow")
    : "said";

  return (
    <>
      <InsightWell
        compact
        label={null}
        prompt={top}
        body={body}
        floor={phone ? floor : <div className="relative z-10 flex min-w-0 flex-1 items-center gap-2">{floor}</div>}
        className={className}
        testid={testid}
        wellRef={wellRef}
        /* ASK-42 A — 12px of padding on a phone, not 16. ASK-48 —
           `kr-well--sunk` below lg: a dimmer wash and a deeper press. */
        paneClassName={cn("max-lg:flex-1 max-lg:p-3", phone && "kr-well--sunk")}
      />
      <DexCapturePopup
        open={popupOpen && phase !== "idle"}
        onClose={closePopup}
        phone={phone}
        step={step}
        text={chat.draft}
        onText={(v) => chat.setDraft(v)}
        transcribing={transcribing}
        files={chat.pendingFiles}
        onRemoveFile={chat.removeFile}
        busy={chat.busy}
        onNext={send}
        onDiscard={discard}
        sentText={sentText}
        stages={steps}
        decisionId={outcome?.kind === "ready" ? outcome.decisionId : null}
        userId={user?.id}
        onSaveDraft={saveDraft}
        outcome={outcome}
        onRetry={onRetry}
      />
    </>
  );
}

export default DeskDexWell;
