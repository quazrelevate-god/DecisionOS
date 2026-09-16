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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Microphone, Stop, PaperPlaneRight, Paperclip, X, Check, WarningCircle, File as FileGlyph,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { captureOutcome, decisionCounts, failureReason, isReading, readyLine, stageLabel, OUTCOME_COPY } from "../../lib/dexOutcome";
import { toastDexOutcome } from "../../lib/dexOutcomeToast";
import { hasPerm } from "../../lib/perms";
import { cn } from "../../lib/utils";
import { useDexCapture } from "../../hooks/useDexCapture";
import { useDexConversation } from "../../hooks/useDexConversation";
import { InsightWell } from "../../components/karma";
import { DexWave } from "../../components/mobile/DexWave";
// ASK-34 item 5 — the same picture the founder met at signup (BuildReveal).
import { DexForgeFit } from "../onboarding/DexForge";

// A capture lands in several caches at once — the same set Layout refreshes
// after the phone's Dex (refreshAfterCapture).
const REFRESH_KEYS = ["captures-pending", "desk", "inbox", "tasks", "dex-inflight-count"];
// The note walks queued -> transcribing -> structuring; these are its endings.
const ENDINGS = ["done", "nothing", "failed", "slow"];
/* ASK-33 Phase 2 named the stages here; ASK-34 A3 moved the words to
   lib/dexOutcome (STAGE_COPY) when the phone's DexChat started printing the
   same four. */
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
/* ASK-34 item 5 — DEX IS THINKING, AND IT LOOKS LIKE THE FORGE.
   The expanded well showed the stages as text alone. DexForge is the picture
   the founder already met once, at signup, while Dex built their company out
   of what they had just said — the same moment, so the product reads as one
   thing rather than two. ASK-34 A3 puts the same picture in the phone's
   DexChat, so the scale-to-fit wrapper it needs lives beside the forge itself
   (DexForgeFit) rather than being written twice. */

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
 * @param {React.RefObject} [growToPhoneRef]   ASK-35 2.2 — the same, below lg:
 *                                             the Desk's hero
 * @param {React.RefObject} [growToRef]        ASK-33 Phase 2 — the element whose
 *                                             top the expanded well grows to
 *                                             (the Desk's KPI grid)
 * @param {Function}        [onExpandedChange] told true/false as the well becomes
 *                                             and stops being the workspace, so
 *                                             the Desk can fade what it covers
 * @param {Function}        [onLater]          ASK-36 2 — told the decision id
 *                                             when a ready one is set aside
 * @param {Function}        [onReview]         ASK-33 Phase 3 — opens a ready
 *                                             decision in the Desk's existing
 *                                             DecisionDialog
 */
export function DeskDexWell({ className, testid, growToRef, growToPhoneRef, onExpandedChange, onReview, onLater }) {
  const { user } = useAuth();
  // The gate every Dex capture surface uses (DexFab, DexCaptureBar). This used to
  // list DexSheet too; DexSheet was removed from Layout in 97c2bfc (KM-23) and is
  // not mounted — the live sheet is DexChat, opened behind DexFab's gate.
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
  const chat = useDexConversation({ dex, open: true, channel: "decide", onCommitted: refresh, userId: user?.id });
  draftSinkRef.current = chat.setDraftFromVoice;
  // For toasts, which act long after the render that raised them.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef(null);

  // KM-53 — the window between "stop" and the words coming back, as Layout
  // computes it for the dock: the upload and the transcript poll, narrowed to
  // the moment there is genuinely nothing in the field yet.
  const transcribing = !!dex.sending && !chat.draft;
  /* ASK-33.2 — THE FIELD IS THE COMPOSER. It is a text field by default; the
     wave takes its place only while recording, and hands the words back to it
     when the recording stops (KM-51). There is no mode to switch into. */
  const recording = !!dex.recording;
  const canSend = !!chat.draft.trim() || chat.pendingFiles.length > 0;
  /* ASK-36 1 — AN ATTACHMENT MUST NOT EAT THE MICROPHONE. `canSend` drove this,
     and pendingFiles makes canSend true — so the moment a document was attached
     the mic turned into a send arrow and the only way left to say what to do
     with it was to type. On the very screen whose own words are "Attached. Say
     or type what to do with it". Only TEXT in the field turns it into send now;
     a file on its own leaves the mic a mic, which is the whole point of
     attaching something and then speaking about it. Sending a bare file with no
     instruction is still possible — the field's Enter key sends whatever
     `canSend` allows — it just is not what the button offers. */
  const intent = dex.recording ? "stop" : chat.draft.trim() ? "send" : "mic";

  /* ASK-33 Phase 5 — THE FIELD GROWS TO TWO LINES, no further, so a decision
     can be read back whole before it is sent (at 360px one line holds about
     half of "Tell Suresh to ship the indigo lot before Friday"). Measured from
     the field's own line height and padding, so the phone's 16px text and the
     desktop's 14px both land on exactly two lines; past that it scrolls inside
     itself.
     ASK-34 item 1 — the pill stays FULLY ROUNDED as it grows. It used to drop
     to a 22px radius at two lines, on the fear that a 999px end would clip the
     text; measured, it does not. At 68px tall each end is a 34px arc, the text
     sits 10px in from the top and the arc is only 9.9px in at that height —
     the px-4 padding clears it by 6px. */
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
  }, [chat.draft, recording]);

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

  /* ASK-33 Phase 2 — THE EXPANSION. ASK-35 G2: ON BOTH SURFACES NOW.
     On SEND, and only on send, the well becomes the workspace: its pane lifts
     out of the flow, anchored to the well's floor, and grows upward until its
     top meets a target beside or above it, while the Desk fades what it passes
     over. The well's own box never changes size, so nothing else on the page
     moves. One long ease-out drives the growth and the fade (index.css
     .kr-dex-grow / .kr-dex-fade), so it settles rather than stops, and
     collapsing is the same move run backwards. Under prefers-reduced-motion the
     transitions are off and the expanded state is simply painted.

     ON SEND, AND ON NOTHING ELSE. This is the whole reason KM-23 exists and it
     is the one rule that must not bend: the workspace opens from send() and
     from no other path. Never from `dex.understanding` becoming truthy, never
     from a poll result, never from any capture state — the poll re-populates
     that state after an ending, so a workspace keyed off it re-opens itself
     once the founder has dismissed it, which IS the ghost card KM-23 deleted.
     onRetry goes through the same setOutcome/expand pair while the pane is
     already open; it never opens one.

     WHAT IT GROWS TO, PER SURFACE. Desktop takes the top of the KPI grid beside
     it (growToRef), which on that layout is the top of the hero. The phone has
     no grid beside it — the strip is above the well — so its honest equivalent
     is the top of the HERO itself (growToPhoneRef): the workspace covers the
     greeting, the score cluster and the 2x2 KPI strip, exactly as the desktop
     one covers the greeting, the slider, the numeral and the gauge. */
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
    // ASK-35 2.2 — the target is the surface's own: the KPI grid on desktop,
    // the hero on a phone.
    const grid = (isDesktop() ? growToRef : growToPhoneRef)?.current;
    if (!well || !grid) return null;
    const rest = well.offsetHeight;
    const wb = well.getBoundingClientRect();
    const gb = grid.getBoundingClientRect();
    // UI-SCALE: rects are in visual px, offsetHeight in the element's own px.
    const k = wb.height ? rest / wb.height : 1;
    return { from: rest, to: Math.round(rest + Math.max(0, (wb.top - gb.top) * k)) };
  }, [growToRef, growToPhoneRef]);

  const expand = () => {
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

  /* ASK-35 2.2 — RE-MEASURE ONCE THE PANE IS OUT OF THE FLOW. expand() measures
     inside the send handler, when the composer may still be two lines tall with
     the words about to be sent: the well is 157 there and 150 a frame later,
     once ask() has cleared the draft — so the pane was built 7px too tall and
     its top overshot the target by exactly that. Measured again after the lift,
     the well is its resting self (the pane is absolute, so nothing of the
     conversation is in its box) and the number is right whatever the field was
     doing. Two frames, because that is when the flow has settled. */
  useEffect(() => {
    if (!growing) return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const m = measure();
        if (m) setGrow((g) => (g && g.to !== m.to ? { ...g, to: m.to } : g));
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [growing, measure]);

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

  /* The target stays the constraint at any size: re-measure on resize. ASK-35
     G2 removed the "let go entirely below lg" branch — crossing the breakpoint
     now just swaps which element measure() reads, and dropping the workspace on
     a resize would throw away a capture the founder is still watching. */
  useEffect(() => {
    if (!growing) return undefined;
    const onResize = () => {
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

  /* ASK-33 Phase 1 — Dex's reply to a send, as a toast, where the well has no
     screen for it. ASK-35 G2: both surfaces have that screen now, so this is
     the LATE ENDING path and only that — the founder collapsed the workspace
     before the note finished, and the answer still has to reach them rather
     than being dropped on the floor. The words and actions are the sheet's own
     late toasts' (lib/dexOutcomeToast). The "reading it now" acknowledgement is
     skipped because it lands while the note is still being followed. */
  const awaitingReplyRef = useRef(false);
  const seenLogRef = useRef(0);
  const understandingRef = useRef(null);
  understandingRef.current = dex.understanding;
  // A kept capture's Retry, from its toast: the ending is reported the same way.
  const retryKept = async (o) => {
    endingRef.current = null;
    awaitingReplyRef.current = true;
    const ok = await chatRef.current.retry(o.retry);
    if (!ok) awaitingReplyRef.current = false;
  };
  const toastEndingRef = useRef(null);
  toastEndingRef.current = (message) => toastDexOutcome(message, {
    onReview: (id) => onReview?.(id),
    onRetry: retryKept,
    canRetry: () => !!chatRef.current.canRetry,
  });
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
    // The workspace was dismissed before the ending arrived: say it in a toast.
    toastEndingRef.current(reply);
  }, [chat.log]);

  /* ASK-35 G2 — THE HAND-OFF IS GONE. ASK-33 Phase 4-B had the well send the
     capture and pass it to DexChat, because below lg the well had no workspace
     to show an ending in. It has one now (see THE EXPANSION), so the phone
     reads its own answer where it asked the question — and `handToSheet`, the
     `dos:open-dex` decide dispatch and THE GUARD that existed for the case
     nothing took the hand-off all go with it. The Ask sheet is untouched.

     ASK-33.1 — the capture being read may still be the ASK SHEET's, and this
     well cannot see that hook. Layout answers on an event. It stays: the sheet
     can still be busy on /ask and must still be able to refuse a send. */
  const sheetReading = () => {
    const ev = new CustomEvent("dos:dex-state", { detail: { reading: false } });
    window.dispatchEvent(ev);
    return !!ev.detail.reading;
  };

  const send = async () => {
    if (!canSend || dex.sending || chat.busy) return;
    /* ASK-33.1 — ONE CAPTURE AT A TIME. A second send while Dex is still reading
       the first retires that poll: the decision would still land in the Decisions
       column, but a FAILURE would have nowhere to land (plan 5.2). Refused in the
       founder's words, and released the moment the first note ends. */
    if (isReading(dex) || sheetReading()) { toast(OUTCOME_COPY.stillReading); return; }
    endingRef.current = null;
    /* ASK-35 2.1 — ONE PATH, BOTH SURFACES. This is the only place the
       workspace opens. */
    awaitingReplyRef.current = true;
    setSentText(chat.draft.trim() || chat.pendingFiles.map((f) => f.name).join(", "));
    setOutcome(null);
    expand();
    /* ASK-35 2.4 — below lg the page scrolls, so the well may be half off the
       screen when the founder sends from it. Bring the whole workspace into
       view; on desktop the Desk is one screen and there is nothing to scroll. */
    if (!isDesktop()) {
      requestAnimationFrame(() => wellRef.current?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "end",
      }));
    }
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
  /* ASK-33.2 — the mic is the mode switch: it starts a recording, stops one
     (the words land in the field for review, KM-51), and sends once there is
     something to send. DexFab's three intents, on the Desk. */
  const onMic = () => {
    if (dex.recording) { dex.stopRecording(); return; }
    // Upload or transcript still on its way: a tap here would record over the
    // words that are about to come back (KM-51).
    if (dex.sending || chat.busy) return;
    // The button does what its glyph says, and its glyph follows the FIELD, not
    // the attachments (see `intent`).
    if (chat.draft.trim()) { send(); return; }
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

  // The FAB's glyphs (DexFab), so the two Dex controls speak one language.
  const MicGlyph = intent === "stop" ? Stop : intent === "send" ? PaperPlaneRight : Microphone;
  const micLabel = intent === "stop" ? "Stop recording" : intent === "send" ? "Send to Dex" : "Speak to Dex";

  /* The line under "Dex". Attached files take its place rather than adding a
     row, so the well never changes height. The row's py-2 / -my-2 pair gives
     each remove its 44px target without moving anything around it. */
  /* ASK-33 Phase 3 — files attached for the NEXT capture show while the well
     is the workspace too, now that it stays open on an ending; only the prompt
     line gives way there. */
  const prompt = chat.pendingFiles.length > 0 ? (
    <ul aria-label="Attached files" className="-mb-2 -mt-0.5 flex min-w-0 gap-touch-gap overflow-x-auto py-2 [scrollbar-width:none]">
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
  const outcomeCounts = decisionCounts(readyDecision);
  const quietPill = "kr-pop flex h-10 items-center rounded-pill px-4 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60";
  const inkPill = "flex h-10 items-center rounded-pill bg-kr-ink px-5 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60 disabled:opacity-40";
  const outcomeView = !outcome ? null : outcome.kind === "ready" ? (
    <div data-testid="dex-outcome-ready" className="flex min-h-0 flex-1 flex-col">
      <p data-testid="desk-dex-summary" className="text-[17px] font-semibold leading-snug text-foreground">
        {readyLine(readyDecision, user?.id)}
      </p>
      {readyDecision?.title && (
        <p className="mt-1 line-clamp-2 text-sm leading-snug text-foreground/70">{readyDecision.title}</p>
      )}
      {/* ASK-35 2.6 — TWO ACROSS ON A PHONE. Four tiles in a 296px row gave
          each label a 44px box, and "Approvals" and "Meetings" were both cut
          at 360. The tile is the same tile; there are two of them per line. */}
      <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
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
        {/* ASK-36 2 — "Later" is a decision about the decision: it was read,
            understood and set aside. The Desk's Decisions column marks the rows
            that happened to, so the founder can find what they walked away
            from instead of hunting for it among everything else. */}
        <button
          type="button"
          data-testid="desk-dex-later"
          onClick={() => { onLater?.(outcome.decisionId); collapse(); }}
          className={quietPill}
        >
          Later
        </button>
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
      {/* Phase 5 — a long raw reason scrolls inside its own block, so Retry and
          Not now stay whole and in view beneath it rather than sliding under
          the composer. */}
      <p className="flex min-h-0 shrink items-start gap-2 overflow-y-auto text-[17px] font-semibold leading-snug text-foreground">
        <WarningCircle size={20} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-rose-600" />
        {/* The reason is the whole point of this ending: it wraps, never truncates. */}
        <span className="min-w-0 break-words">{outcome.message}</span>
      </p>
      {/* ASK-35 2.6 — it is the one way out of the one failure that matters,
          and it was a 20px line of text. It keeps the underline that says it is
          a link and takes the 44px floor below lg (MPWA-01 §5.1); on desktop it
          stays exactly the inline link it was. */}
      {outcome.href && (
        <Link
          to={outcome.href}
          data-testid="dex-outcome-settings"
          className="mt-2 inline-flex w-fit shrink-0 items-center text-sm font-medium text-foreground underline underline-offset-4 max-lg:min-h-touch"
        >
          {outcome.linkLabel}
        </Link>
      )}
      <div className="mt-auto flex shrink-0 flex-wrap items-center gap-2 pt-4">
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
      {outcome ? outcomeView : (
      /* ASK-34 item 5 — TWO COLUMNS, NOT ONE LAYER OVER ANOTHER. The stages
         keep the left, left-aligned, exactly as they were; the forge takes the
         space beside them and is centred in it, with a 24px trough between so
         neither crowds the other. It is drawn only while Dex is reading — the
         branch it sits in is the one an outcome replaces, so it leaves the
         instant a result arrives. Under prefers-reduced-motion it is not drawn
         at all and the stage text stands alone. */
      /* ASK-35 2.5 — SIDE BY SIDE ON DESKTOP, STACKED ON A PHONE. At 390 the
         two-column split gave the forge about 150px and the stages about 150px,
         which is not a layout, it is two cramped columns. Below lg the quote and
         the stages take the top, full width, and the forge sits under them in
         whatever height is left — with a floor, so a long stage list cannot
         crush it to nothing. */
      <div className="flex min-h-0 flex-1 gap-6 max-lg:flex-col max-lg:gap-3">
        {/* Half each on desktop. The forge is WIDTH-bound at that size —
            measured, the box it gets is wider than 304 only past 2xl — so every
            pixel the stages do not need is a pixel it draws with. */}
        <div className="flex min-w-0 flex-col lg:flex-1">
          {/* Two lines on a phone, three on desktop: the pane is the same 354px
              tall either way, and every line the quote takes is a line the forge
              loses. What was said is still one tap from being read in full. */}
          {sentText && (
            <p className="line-clamp-2 text-[15px] leading-snug text-foreground lg:line-clamp-3">&ldquo;{sentText}&rdquo;</p>
          )}
          {/* Tighter on a phone: four stages at 10px apart cost 110px of a
              234px body, and every pixel they do not need is a pixel the forge
              under them draws with. */}
          <ol className="mt-3 space-y-1.5 lg:mt-4 lg:space-y-2.5" aria-label="What Dex is doing">
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
                  {stageLabel(s)}
                </li>
              );
            })}
          </ol>
        </div>
        {!prefersReducedMotion() && (
          <DexForgeFit
            testid="desk-dex-forge"
            label="Dex is building what you decided"
            /* A floor, so a four-stage list cannot crush it to nothing — but a
               LOW one. At 7.5rem the quote, the four stages and the forge came
               to more than the pane holds and the body started scrolling, which
               is the nested-scroller trap Group 1 spent its height rules
               avoiding; the forge was cut off at the composer. 5rem fits the
               worst case (four stages, a two-line quote) with room over. */
            className="min-h-0 min-w-0 flex-1 max-lg:min-h-[4.5rem]"
          />
        )}
      </div>
      )}
    </div>
  ) : null;

  const floor = (
    <>
      {/* ASK-33.2 — THREE ELEMENTS, NO EXPANSION: attach · field · mic.
          The [+] that revealed two circles is gone (founder, 2026-09-16), and
          with it the reveal's containment invariant, its invisible hitbox and
          the draft it used to hide. Attach is one tap on its own circle. */}
      <button
        type="button"
        data-testid="desk-dex-attach"
        onClick={() => fileInputRef.current?.click()}
        disabled={!canCapture || chat.busy}
        aria-busy={attaching || undefined}
        aria-label="Attach a file"
        title="Attach a file"
        className={cn(CIRCLE, attaching && "animate-pulse")}
      >
        <Paperclip size={17} weight="bold" aria-hidden="true" />
      </button>
      {/* Any file type — the pipeline reads what it can (plan 5.4). */}
      <input ref={fileInputRef} type="file" className="hidden" tabIndex={-1} onChange={onPickFile} />

      {/* THE FIELD IS SUNKEN. It wore .kr-pop, inherited from the "Chase it"
          button it replaced — and KM-62 / KM-65 keep that raised recipe for
          things you PRESS. An input is not a button, so the circles either
          side stay raised and the field is pressed into the well.
          ASK-34 items 1 and 2 — and the recipe is .nm-field, not .nm-inset.
          nm-inset is a CONTAINER recipe: bg-nm-sunken, a flat grey step under
          the canvas, which is why the pill read as a form control dropped on
          the well rather than the old "Chase it" pill pressed into it.
          .nm-field is the app's own field (pages/Settings.js, pages/Leave.js,
          pages/MyWork.js): WHITE at 80%, a 1px inset hairline and a 2px inner
          shadow off the top edge — white and concave at once, which is exactly
          what was asked for. It also carries the app's OWN focus treatment
          (index.css .nm-field:focus-within — ring-2 ring-neutral-900/25), so
          the hand-rolled ring-kr-ink/60 goes: that was the black outline, and
          it was black because it was written here instead of taken from the
          recipe. Focus is not lost — NM-4 §5 still has its visible ring, in
          the neutral every other field in the app uses.
          KM-53 — while transcribing it is read-only: the words arrive as a
          setDraft that would wipe anything typed in the gap. */}
      <div
        data-testid="desk-dex-composer"
        data-mode={recording ? "voice" : "type"}
        /* min-h from the same token that lifts the circles and the field to
           44px below lg (index.css --control-h-sm), so the pill never sits
           shorter than its neighbours on a phone. */
        className={cn(
          "nm-field flex min-h-[var(--control-h-sm)] min-w-0 flex-1 items-center overflow-hidden rounded-pill",
          // A fixed 40px while it draws the wave; as a field it takes the
          // field's own height, one line or two.
          recording ? "h-10" : "h-auto"
        )}
      >
        {!recording ? (
          <textarea
            ref={fieldRef}
            rows={1}
            value={chat.draft}
            readOnly={transcribing}
            disabled={!canCapture}
            onChange={(e) => chat.setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
            // Short enough to fit whole at 360px, where the field is ~150px of text.
            placeholder={transcribing ? "Transcribing…" : "Type a decision…"}
            aria-label="Tell Dex what you decided"
            className={cn(
              // Enter still sends (onKeyDown); the text wraps, it never breaks lines.
              "block min-w-0 flex-1 resize-none bg-transparent px-4 py-2.5 text-sm leading-5 text-foreground focus:outline-none max-lg:leading-6 [scrollbar-width:none]",
              // A status being waited on should not wear the grey of a hint.
              transcribing ? "animate-pulse placeholder:text-foreground/75" : "placeholder:text-foreground/45"
            )}
          />
        ) : (
          /* Recording: the field becomes the wave, and gives the words back to
             the field when it stops (KM-51). tone="ink" — KM-62's light-surface
             ribbons; levelsRef, not levels, so the meter never renders the well
             (KM-60). It mounts only while recording, so nothing animates at
             rest — which is also what let the mobile audit settle. */
          <div className="h-full min-w-0 flex-1 px-4 py-1.5">
            <DexWave tone="ink" state="listening" levelsRef={dex.levelsRef} />
          </div>
        )}
      </div>

      {/* The Brain circle, now the microphone. */}
      <button
        type="button"
        data-testid="desk-dex-mic"
        data-intent={intent}
        // ASK-33.1 — still pressable: pressing it says why, rather than going dead.
        data-blocked={intent === "send" && isReading(dex) ? "reading" : undefined}
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
      paneClassName={cn("max-lg:flex-1", grow && growPhase !== "start" && "kr-dex-grow")}
      paneStyle={grow
        ? { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 10, height: growPhase === "open" ? grow.to : grow.from }
        : undefined}
      onPaneTransitionEnd={onPaneTransitionEnd}
    />
  );
}

export default DeskDexWell;
