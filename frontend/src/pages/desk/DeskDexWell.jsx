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
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PaperPlaneRight, Paperclip, X, Check, File as FileGlyph, Keyboard, Microphone } from "@phosphor-icons/react";
import { useAuth } from "../../context/AuthContext";
import { captureOutcome, failureReason, isReading, OUTCOME_COPY } from "../../lib/dexOutcome";
import { toastDexOutcome } from "../../lib/dexOutcomeToast";
import { hasPerm } from "../../lib/perms";
import { cn } from "../../lib/utils";
import { useDexCapture } from "../../hooks/useDexCapture";
import { enableProximity, disableProximity } from "../../lib/native/proximity";
import { useDexConversation } from "../../hooks/useDexConversation";
import { InsightWell } from "../../components/karma";
// ASK-47 — the ripple the founder signed off in the lab, now the mic.
import { VoiceRipple, DESK_RIPPLE } from "../../components/karma/VoiceRipple";
import { DexWave } from "../../components/mobile/DexWave";
import { DraftNote } from "../../components/karma/DraftNote";
import { KeptPill } from "./KeptPill";
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
/* DOOR_CIRCLE — the same circle, at the platform's default target.
   accessibility.md › Offer sufficiently sized controls puts iOS at 44x44 pt
   default, 28x28 pt minimum. CIRCLE is h-10 = 40 CSS px, and --ui-scale's 0.8
   makes that 32 REAL pixels: over the minimum, well under the default, on a
   full screen that has nothing else competing for the room. 3.5rem lands at
   44.8. Only the door takes it; the well's floor is a packed row and changing
   it there is a separate decision with its own layout to re-measure. */
const DOOR_CIRCLE = "h-14 w-14";
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

/* When the on-screen keyboard opens, the composer floats just above it. This
   reads the visual viewport in the app's zoomed CSS space (--ui-scale, as
   DexCapturePopup's useKeyboardSafeBox does) and returns where the floating
   bar's bottom edge should sit and how much room is left above the keyboard. */
function useKeyboardInset(active) {
  const [kb, setKb] = useState({ open: false, bottom: 20, avail: 0 });
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) { setKb({ open: false, bottom: 20, avail: 0 }); return undefined; }
    const read = () => {
      const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
      const kbReal = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const next = {
        open: kbReal > 90,
        bottom: Math.round(kbReal / k + 20),   // 20px above the keyboard
        avail: Math.round(vv.height / k),       // visible height, for the grow cap
      };
      setKb((p) => (p.open === next.open && p.bottom === next.bottom && p.avail === next.avail ? p : next));
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => { vv.removeEventListener("resize", read); vv.removeEventListener("scroll", read); };
  }, [active]);
  return kb;
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
/* DEX-SLIDER Part 3 — `surface` is the only thing the slider's door changes.
 *
 * "well"    the box on the Desk, exactly as it has always been.
 * "overlay" the full screen the slider's right end opens: the same mic, the
 *           same ripple, the same attach and keyboard, the same kept draft —
 *           and the same handover to DexCapturePopup at the same moment.
 *
 * It is a presentation, deliberately, not a second implementation. Everything
 * below this line — the capture hook, the conversation, the one-at-a-time
 * guard, the refusal, the draft that survives a reload, the pop-up — is shared
 * code reached by both, so the door cannot drift from the well it replaces.
 */
export function DeskDexWell({ className, style, testid, phone = false, onReview, onLater,
                              surface = "well", open = false, onClose, onMeter }) {
  const { user } = useAuth();
  // The gate every Dex capture surface uses (DexFab, DexCaptureBar).
  const canCapture = hasPerm(user, "voice_capture");
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

  /* PILOT — ON A PHONE THE COMPOSER FLOATS ABOVE THE KEYBOARD. When the field
     is open on a phone, it is lifted out of the (collapsing) well and docked
     20px above the keyboard, growing with the text up to ~40% of the room the
     keyboard leaves, then scrolling. Desktop keeps the in-card two-line field. */
  const floating = phone && fieldOpen;
  const kb = useKeyboardInset(floating);
  /* DEX-SLIDER Part 5 — the composer has to clear whatever it was opened from.
     The door shipped in Part 3 with this wrong. On the Desk the composer floats
     over the page at 60/70; opened from the full-screen door, which is itself at
     9500, those same numbers put it BEHIND the door's own backdrop, so pressing
     the keyboard looked like it did nothing — the field was there, under a blur.
     Only verify:slider found it, because the check that existed counted the
     composer in the DOM rather than asking whether you could see it.
     Both pairs keep the two relationships that matter: the scrim 10 under the
     bar, and both of them UNDER THE DOCK (10000), which is how it already
     behaves on the Desk and not something the door should change. */
  const composerZ = surface === "overlay" ? 9560 : 60;
  const roomAbove = kb.avail || (typeof window !== "undefined" ? window.innerHeight : 640);
  const growCap = Math.max(120, Math.round(roomAbove * 0.4));

  /* THE FIELD GROWS WITH THE SENTENCE. (2026-10-05 — was two lines.)
     Founder: "the text box is not dynamically increasing its height based on
     the number of text lines, instead it's going in an infinite line in a
     single row." It was wrapping all along — a textarea always does — but the
     BOX was pinned to two lines and the rest scrolled out of sight, so one row
     of visible words is all you ever got.
     IN_CARD_LINES is the ceiling, not the height: the field is one line until
     there are two, and it only scrolls once the text passes the ceiling. Five
     is what fits above the Desk's own card without the composer eating it.
     While floating (the keyboard is up) it keeps growCap, which is measured
     against the room the keyboard left rather than guessed. */
  const IN_CARD_LINES = 5;
  const fieldRef = useRef(null);
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = "auto";
    const max = floating ? growCap : Math.round(line * IN_CARD_LINES + pad);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [chat.draft, recording, fieldOpen, floating, growCap]);

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
    if (stillReading()) {
      toast(OUTCOME_COPY.stillReading);
      /* 2026-09-30 — AND PUT THE FIELD AWAY ON THE REFUSAL TOO. This returned
         before the setTyping(false) below, which was harmless while the
         composer lived inside the well. Now that a phone floats it over a
         fixed inset-0 scrim, a refusal left the whole Desk blurred behind an
         open field: the toast says "Dex is still reading your last one", and
         the status pill it is pointing you back to could not be tapped,
         because the scrim was over it. The draft is kept — the same thing
         tapping the scrim does — so the words go again the moment the first
         capture lands.
         The mic path at the other stillReading() guard has the same shape;
         left alone here because recording-while-open is KM-51's business. */
      setTyping(false);
      setPillDraft(false);
      return;
    }
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

  /* PILOT-2 B — Save as draft: marked in the Decisions column, and the pop-up
     is done. The decision itself was saved on the server when Dex made it.
     2026-09-27 — IT WAITS FOR THE ANSWER NOW. This said "Saved as a draft" the
     moment it was pressed and sent the request afterwards; when the mark was a
     note in this browser that could not fail, so it never lied. It is a call
     to the server now (the flag is on the decision, so it reaches the phone
     too), and a refusal — no signal on the factory floor, or somebody decided
     it thirty seconds ago — left the founder holding two contradictory
     messages, the false one first. So: pressed, then saved, then said. A
     failure keeps the pop-up open with what Dex made still in it. */
  const saveDraft = async (id) => {
    try {
      await onLater?.(id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Couldn't save it as a draft — it is still waiting on you.");
      return;
    }
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
  const overlayRef = useRef(null);
  useEffect(() => {
    if (!phone) return undefined;
    const el = surface === "overlay" ? overlayRef.current : wellRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const fit = () => {
      const room = Math.min(el.offsetWidth - 40, el.offsetHeight - 128);
      setRippleSize((s) => {
        /* The well caps at 300 because that is all its box can hold. The
           overlay has the screen, and the brief asks for the ripple to run out
           across the whole of it — so the cap is the room itself, with the same
           88px floor so a 44px hub always has somewhere to live. */
        const ceiling = surface === "overlay" ? Math.max(88, Math.round(room)) : 300;
        const next = Math.max(88, Math.min(ceiling, Math.round(room)));
        return Math.abs(next - s) > 2 ? next : s;
      });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [phone, surface, open]);

  const rippleDisabled = !canCapture || (!recording && (dex.sending || chat.busy));

  /* THE DOOR STANDS ASIDE THE MOMENT THE CAPTURE HAS SOMEWHERE ELSE TO GO —
     and it does it by NOT DRAWING, not by closing.
     First cut closed it: `popupOpen` became true, an effect called onClose, and
     Desk flipped the state useBackDismiss owns. That worked in Chromium — a
     probe watched the pop-up sit there at step 1 for eight seconds with the
     door gone — and failed on the founder's iPhone, where stopping the mic
     made everything vanish and the words came back ten seconds later as a kept
     draft, meaning the pop-up had been dismissed as it mounted. Closing the
     door runs useBackDismiss's teardown, which calls history.back(); doing that
     in the same tick as a Radix dialog mounting is a race, and WKWebView loses
     it. I could not reproduce it to prove the mechanism, so the fix removes the
     race rather than arguing with it.
     So while the pop-up is up the door simply renders nothing — no state
     change, no history, nothing to race — and the door is only truly closed
     once the pop-up is gone, in a tick where no dialog is mounting. */
  /* THE DOOR OPENS LISTENING (2026-10-01, founder).
     It deliberately did not, and the note said why: "a screen that is already
     listening the moment it appears startles people." The founder has used it
     and disagrees — reaching the decision screen already costs a full drag, and
     having to find the mic afterwards makes that drag feel like it did nothing.
     So the drag IS the press.
     It starts only from a clean slate: nothing already recording, nothing being
     transcribed or sent, no kept words waiting to be read back, and the capture
     gate open. Each of those would otherwise have opened the pop-up or shown a
     refusal instead, and starting a recording over them is the bug this guard
     exists to prevent (ASK-33.1). onMic is reused rather than reimplemented so
     there is still one description of what pressing the mic means. */
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const armedRef = useRef(false);
  useEffect(() => {
    if (surface !== "overlay") return;
    if (!open) { armedRef.current = false; return; }
    if (armedRef.current) return;
    armedRef.current = true;
    /* STRAIGHT THROUGH onMic, GUARDS AND ALL. The first cut tested the guards
       here and returned quietly when one failed — which on the slider meant a
       drag right while Dex was still reading did NOTHING AT ALL: no capture, no
       refusal, a handle parked against a dead track. onMic already knows every
       one of these rules and says so out loud (ASK-33.1's "Dex is still reading
       your last one", the kept-words hand-off, the capture gate), so it is the
       one description of what starting a capture means and this just calls it.
       And if nothing started, the control goes home rather than sitting parked
       on a recording that is not happening. */
    const t = setTimeout(() => {
      onMic();
      setTimeout(() => {
        if (!recordingRef.current && !popupOpenRef.current) onClose?.();
      }, 500);
    }, 120);
    return () => clearTimeout(t);
    /* [surface, open] AND NOTHING ELSE, deliberately. Written without a
       dependency list first, which meant it re-ran on every render — and since
       this well re-renders constantly while a capture is live, each run's
       cleanup cancelled the pending start before the 260ms was up. The door
       opened silent and the check caught it. The guards above read the state as
       it is at the moment the door opens, which is exactly when the decision
       needs taking. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, open]);

  /* CLOSING THE DOOR STOPS THE MIC. It never had to before, because recording
     only ever began with a deliberate press and whoever pressed it would press
     it again. Now the door starts listening by itself, so X or the back gesture
     could leave a microphone running behind a screen that is gone — which is
     the worst thing an auto-start can do.
     Stopping is not discarding, which is this component's rule throughout
     (ASK-33): the words finish transcribing and land as a kept draft that the
     Desk offers back. Nothing is sent, and nothing is lost. */
  useEffect(() => {
    if (surface !== "overlay") return;
    if (!open && recording) dex.stopRecording();
  }, [surface, open, recording, dex]);

  const handedOver = useRef(false);
  useEffect(() => {
    if (surface !== "overlay") return;
    if (open && popupOpen) { handedOver.current = true; return; }
    if (!popupOpen && handedOver.current) { handedOver.current = false; onClose?.(); }
  }, [surface, open, popupOpen, onClose]);

  /* DEX-SLIDER Part 4 — THE PHONE AT YOUR EAR. Monitoring runs for exactly one
     state: this is the decision door, it is open, and it is recording. Every
     other combination is off, which is why the condition is written as one
     expression rather than as an enable here and a disable in four places — a
     phone left with a dark screen because a path was missed is the worst thing
     this feature can do, and a missed path is the only way it happens.
     The cleanup runs on unmount, on the door closing, on recording stopping
     and on a failed capture, because all four change this expression. */
  const atEar = surface === "overlay" && open && recording;
  useEffect(() => {
    if (!atEar) return undefined;
    let live = true;
    enableProximity().then((on) => { if (!live && on) disableProximity(); });
    return () => { live = false; disableProximity(); };
  }, [atEar]);

  /* …AND THE SCREEN COMES BACK IF THE APP GOES AWAY. Backgrounding does not
     unmount this, so the effect above would hold monitoring while the founder
     is in another app. Recording itself is left alone: the brief asks for
     nothing to stop on its own, and it does not. */
  useEffect(() => {
    if (!atEar || typeof document === "undefined") return undefined;
    const onHide = () => { if (document.hidden) disableProximity(); else enableProximity(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [atEar]);

  /* The door's rings read the same meter, per frame, through a CSS variable —
     never React state. KM-60's rule: a meter write that goes through React
     re-renders this well, its pop-up and everything above it ~18 times a
     second, and the only thing that needs to know is one element's style. */
  const waveRef = useRef(null);
  useEffect(() => {
    if (!recording) return undefined;
    let raf = 0, gain = 0.5;
    const tick = () => {
      const el = waveRef.current;
      if (el) {
        const lvl = Math.max(0, Math.min(1, readLevel() || 0));
        gain += ((0.45 + lvl * 1.3) - gain) * 0.16;   // eased, so a spike cannot strobe
        el.style.setProperty("--mw-gain", gain.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording, readLevel]);

  /* The Desk's slider draws its ripple off THIS capture's meter — the one the
     page already owns. A second useDexCapture would be a second MediaRecorder
     on the same microphone, so the reader is handed up instead. It is a ref
     reader and stable, so the slider can call it every frame and nothing above
     it re-renders. */
  const stopRef = useRef(null);
  stopRef.current = () => onMic();
  /* 2026-10-09 (founder) — AND A CANCEL BESIDE THE STOP. Dragging the parked
     handle back to the centre: the take is thrown away (useDexCapture's
     cancelRecording — nothing uploaded, nothing structured, no step 1 and no
     kept draft) and the door closes, so the control is back at rest and the
     next drag right starts again from nothing. Unlike closing the door, which
     is never cancelling (above), this is the one gesture that means it. */
  const cancelRef = useRef(null);
  cancelRef.current = () => {
    dex.cancelRecording();
    setWaitingWords(false);
    onClose?.();
  };
  useEffect(() => {
    onMeter?.({
      readLevel,
      levelsRef: dex.levelsRef,
      recording,
      capturing: surface === "overlay" && open,
      stop: () => stopRef.current?.(),
      cancel: () => cancelRef.current?.(),
    });
  }, [onMeter, readLevel, dex.levelsRef, recording, surface, open]);

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
  const keptLabel = chat.draftKept?.restored
    ? "Kept from before — not sent to Dex yet"
    : "What you said is kept — not sent to Dex yet";
  /* ON THE PHONE IT IS A PILL YOU CAN FLICK AWAY. (2026-10-06, founder: "the
     way it displays in the home screen is not quite nice — make it a pop-up
     floating pill with swipe-gesture closable functionality.") It was a bare
     line of 12px type with two text buttons, printed across the top of the Desk
     above the dock: correct, and it read as a stray sentence rather than as the
     app telling you something. Same words, same two ways out, in the same
     material the capture's own status pill uses — and a swipe in any direction
     puts it away.
     SWIPING IT AWAY IS NOT DISCARDING IT. The words stay kept: the next capture
     still opens on them, and `Discard` is still the only thing that throws them
     out. Hiding and deleting must not be the same gesture, least of all the
     careless one.
     Desktop keeps the inline note (the well is a real box there, with a place
     for a line of type; a pill floating over a laptop screen would be the
     stray object instead). */
  const keptDraft = kept && !popupOpen ? (
    surface === "overlay"
      ? <KeptPill testid="dex-well-draft" label={keptLabel} onOpen={openSaid} onDiscard={discard} />
      : <DraftNote testid="dex-well-draft" className="mb-1.5"
          label={keptLabel} onOpen={openSaid} onDiscard={discard} />
  ) : null;
  const statusKey = phase === "reading" ? "reading" : phase === "ended" ? outcome?.kind : null;
  const capturePill = !popupOpen && statusKey ? (
    <button
      type="button"
      onClick={() => setPopupOpen(true)}
      data-testid="dex-well-status"
      data-status={statusKey}
      /* The same opaque pill as the kept note beside it (KeptPill): these two
         are the only things that appear in this spot, they appear over the
         Desk's black sheet, and a 38% white wash on black is a smudge. */
      className="mb-1.5 flex min-h-11 w-fit max-w-full items-center gap-2 rounded-pill bg-white px-4 text-sm text-slate-900 shadow-[0_6px_20px_rgb(0_0_0/.28)] ring-1 ring-black/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60"
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
  /* THE DOOR SPLITS `top` IN TWO, along the line of what each piece is about.
     The attached files belong to the door: you press its paperclip, so the
     chips have to appear where you are looking. The "still reading / ready"
     pill and the kept-capture note are about the DESK — they outlive the door,
     which shuts itself the moment the pop-up takes over — so they stay on the
     page, where closing the door can never hide unsent words. */
  const doorTop = attachments
    ? <div className="relative z-10">{attachments}</div> : null;
  const deskTop = (capturePill || keptDraft)
    ? <div className="relative z-10">{capturePill}{keptDraft}</div> : null;

  /* THE DOOR HAS NO RIPPLE. Reported from the iPhone: over a blurred, dimmed
     Desk the waves read as smeared artefacts rather than as an invitation —
     the effect needs an opaque surface behind it to be legible, and the door
     deliberately has none. So the door gets the mic and nothing else, and the
     ripple moves to the one place on the phone that DOES have a solid surface
     for it: inside the slider's own well (DexSlider), where it loops subtly
     and answers the room through this same meter.

     It keeps `desk-dex-ripple` and `voice-ripple-mic`. Those name the capture's
     target, not the animation, and every suite and every habit presses them. */
  const doorMic = (
    <div className="relative grid min-h-0 flex-1 place-items-center" data-testid="desk-dex-ripple">
      {/* THE VOICE, AS CIRCLES. Plain expanding rings on the dimmed Desk, sized
          to run off the screen rather than stop politely short of it, and no
          neumorphic ridge anywhere near them — that recipe needs an opaque
          surface to be read against and this one is deliberately a blur. They
          exist only while the mic is live, and their reach answers the meter,
          so a loud sentence pushes further than a quiet one. */}
      {recording && (
        <span ref={waveRef} aria-hidden="true" className="kr-mic-waves">
          <i style={{ animationDelay: "0s" }} />
          <i style={{ animationDelay: "0.7s" }} />
          <i style={{ animationDelay: "1.4s" }} />
          <i style={{ animationDelay: "2.1s" }} />
        </span>
      )}
      <button
        type="button"
        data-testid="voice-ripple-mic"
        aria-pressed={recording}
        aria-label={micLabel}
        disabled={rippleDisabled}
        onClick={onMic}
        className={cn(
          "relative grid place-items-center rounded-full transition-transform duration-200",
          "h-[7.5rem] w-[7.5rem] disabled:opacity-40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
          /* PRESSED, NOT A RED SQUARE. A filled stop glyph in the alert colour
             read as a warning on a screen where nothing is wrong — and in this
             app the alert colour means money or a deadline at risk. The button
             is the same microphone throughout; listening, it is held down. The
             state is still announced properly through aria-pressed, which is
             what a screen reader reads, not the glyph. */
          recording ? "kr-pressed scale-[0.97]" : "kr-pop"
        )}
      >
        <Microphone
          size={44}
          weight={recording ? "fill" : "regular"}
          aria-hidden="true"
          className={recording ? "text-foreground/90" : "text-foreground"}
        />
      </button>
    </div>
  );

  /* THE RIPPLE IS THE INVITATION in the WELL — the flag-off Desk and desktop,
     both of which are opaque. It runs off the capture the page already owns —
     useDexCapture's meter through `readLevel` — rather than opening a second
     stream onto the same microphone. At rest it breathes; while it is
     listening it answers the room. */
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
      {/* max-lg: 14px / 15px, not 12 / 13. accessibility.md › Use recommended
         defaults puts the iOS minimum at 11 pt; --ui-scale's 0.8 turned 12px
         into 9.6pt and 13px into 10.4pt, both under it. These land at 11.2
         and 12.
         BELOW lg ONLY, and that qualifier is the whole point: this floor is
         SHARED with the desktop well, where --ui-scale is 1 and 12px is
         already 12pt. Bumping it unscoped made the well's floor taller, which
         made the hero taller, which took 91px off the well — caught by
         verify:dex's "the well has not moved" at 1440, flag off. Desktop is
         not in this audit's scope and does not move. */}
      <span className="block text-xs font-semibold tracking-wide text-foreground/75 max-lg:text-sm">Dex</span>
      <span className="mt-0.5 block truncate text-[13px] leading-snug text-foreground/70 max-lg:text-[15px]">
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
          draws its wave in it (KM-51), and gives way to step 1 when it stops.
          On a phone it lifts to the floating bar above the keyboard, so the
          floor shows the title while typing. */}
      {(fieldOpen && !floating) ? (
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
          /* "I'd rather type" WHILE THE DOOR IS LISTENING. The door now opens
             recording, so without this the typing fallback is unreachable on
             the one screen that needs it — the button is disabled for the whole
             life of the recording. Pressing it stops, and what you said arrives
             in the pop-up's first step as editable text. That is the typing
             surface, and it arrives with a head start instead of empty. */
          if (recording) { onMic(); return; }
          if (kept) { openSaid(); return; }
          setTyping(true);
          requestAnimationFrame(() => fieldRef.current?.focus());
        }}
        /* The well keeps its old rule — it does not start on its own, so a live
           recording there means the founder pressed the mic and the keyboard
           has nothing to offer. The door does start on its own, so it must. */
        disabled={!canCapture || chat.busy || (recording && surface !== "overlay")}
        aria-label={fieldOpen && chat.draft.trim() ? "Send to Dex"
          : recording ? "Stop and type instead" : "Type instead"}
        title={fieldOpen && chat.draft.trim() ? "Send to Dex"
          : recording ? "Stop and type instead" : "Type instead"}
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

  /* DEX-SLIDER Part 3 · THE FULL-SCREEN DOOR.
   *
   * Everything behind it is blurred and dimmed — no part of the Desk reads
   * through sharply. The mic is the centre and the ripple runs out from it
   * across the screen; nothing else is in the middle, no stage text and no
   * card, because the one thing being asked for here is a sentence spoken out
   * loud.
   *
   * Attach sits bottom left and the keyboard bottom right — the SAME two
   * controls the well's floor carries, the same handlers and the same testids,
   * because they are literally the same `floor`. The keyboard is a backup path
   * and does not need to be prominent; it only needs to work.
   *
   * `top` is the well's own top row, so a kept capture appears here exactly as
   * it does in the well, with the same Discard. The slider shows nothing about
   * drafts, by design — this screen is where they live.
   *
   * RECORDING DOES NOT START ON OPEN. onMic is the only thing that starts it,
   * as in the well. A screen that is already listening the moment it appears
   * startles people.
   */
  /* THE DOOR IS GONE (2026-10-02, founder). It was a full screen: the Desk
     blurred and dimmed behind a centred mic, with attach and a keyboard in the
     bottom corners. Their redesign retires the whole thing. The slider's own
     track becomes the recording surface — the same move the dock already makes
     for Ask, where the bar you already have turns into Dex rather than a second
     bar being drawn over it (KM-26). So this surface now renders NOTHING of its
     own: it owns the microphone, the conversation, the guards and the pop-up,
     and hands its state up to DexSlider, which draws.
     `surface="overlay"` is kept as the name of that arrangement rather than
     renamed, because it is still what tells this component it is not the well.

     WHAT WENT WITH THE SCREEN, deliberately:
     · the mic button — the slider's handle is the control, and pressing it
       stops and sends.
     · attach and the keyboard — the founder's call, and the reasoning is good:
       you attach to a decision AFTER you have said it, not while you are
       speaking. Attach moved into the pop-up, where the words already are.
     · the blur — there is nothing to dim, because nothing is covered. */

  /* WHAT THE DESK KEEPS WHILE THE DOOR IS SHUT. `top` is the kept-capture note
     and the "Dex is still reading / ready" pill — both of them statements about
     the page, not about the recording screen. Rendering them only inside the
     door would mean that closing it (which now happens by itself the moment the
     pop-up takes over) silently hid the one affordance that offers unsent words
     back. So on the overlay surface they render inline on the Desk instead, and
     the door carries the mic alone. */
  return (
    <>
      {/* The file input lives in the well's floor, which this surface no longer
          renders — so it needs its own. One input either way; the pop-up's
          attach button is what presses this one. */}
      {surface === "overlay" && (
        <input ref={fileInputRef} type="file" className="hidden" tabIndex={-1} onChange={onPickFile} />
      )}
      {surface === "overlay" && deskTop
        ? <div className={cn("relative z-20 order-3 shrink-0 px-1 lg:hidden", className)} style={style} data-testid={testid}>{deskTop}</div>
        : null}
      {surface === "overlay" ? null : (
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
      )}
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
        /* ATTACH AFTER SPEAKING, NOT BEFORE. It used to sit on the recording
           screen's floor, which meant choosing a file before you had said what
           it was for. The founder moved it here, beside the words. */
        onAttach={surface === "overlay" ? () => fileInputRef.current?.click() : undefined}
        attaching={attaching}
      />
      {/* PILOT — THE FLOATING COMPOSER. On a phone, while the field is open, the
          text field and its send sit 20px above the keyboard (kb.bottom), out of
          the collapsing well. Portalled to the body so no ancestor clips or
          moves it; mounted on fieldOpen (not on the keyboard) so showing/hiding
          the keyboard never remounts the textarea and drops focus. */}
      {floating && createPortal(
        <>
        {/* The Desk blurs out behind the floating field so nothing shows
            through it. Tapping it puts the field away (the draft is kept). */}
        <div
          data-testid="desk-dex-floating-scrim"
          onClick={() => { setTyping(false); setPillDraft(false); }}
          className="fixed inset-0 bg-slate-900/25 backdrop-blur-md"
          style={{ zIndex: composerZ }}
        />
        <div
          data-testid="desk-dex-floating"
          style={{ position: "fixed", left: 0, right: 0, bottom: kb.bottom, zIndex: composerZ + 10 }}
          className="px-3"
        >
          <div className="kr-pop mx-auto flex max-w-[34rem] items-end gap-2 rounded-[1.6rem] p-2">
            <div className="nm-field flex min-w-0 flex-1 items-center overflow-hidden rounded-[1.2rem]">
              <textarea
                ref={fieldRef}
                rows={1}
                value={chat.draft}
                disabled={!canCapture}
                onChange={(e) => { setPillDraft(true); chat.setDraft(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                onBlur={() => {
                  // Empty and blurred (not to the send button) closes the field,
                  // as the in-card composer does.
                  if (chat.draft.trim()) return;
                  setTimeout(() => {
                    if (document.activeElement?.getAttribute?.("data-dex-floor") === "1") return;
                    if (fieldRef.current?.value?.trim()) return;
                    setTyping(false);
                  }, 120);
                }}
                placeholder="Type a decision…"
                aria-label="Tell Dex what you decided"
                style={{ maxHeight: growCap }}
                className="block min-w-0 flex-1 resize-none bg-transparent px-4 py-3 text-[15px] leading-6 text-foreground placeholder:text-foreground/45 focus:outline-none [scrollbar-width:none]"
              />
            </div>
            <button
              type="button"
              data-dex-floor="1"
              data-testid="desk-dex-floating-send"
              onClick={send}
              disabled={!canCapture || chat.busy || dex.sending || !chat.draft.trim()}
              aria-label="Send to Dex"
              title="Send to Dex"
              className={CIRCLE}
            >
              <PaperPlaneRight size={17} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </div>
        </>,
        document.body
      )}
    </>
  );
}

export default DeskDexWell;
