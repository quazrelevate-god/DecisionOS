// MPWA-03 / MPWA-12e · DexSheet — what the FAB opens.
//
// The FAB *is* Dex. Sprint 5 (E2-32/E2-33) collapsed capture and AI into one
// persona on the founder's instruction — "remove the ai from the desk button and
// integrate with brain, make it single AI name" — so this sheet drives the
// EXISTING capture endpoints (via hooks/useDexCapture) rather than standing up a
// parallel capture surface.
//
// MPWA-12e (§5.6) replaces the presentation, not the behaviour. It was "a title,
// an input and four full-width text buttons — structurally correct, emotionally
// flat. It looks like a support form, and Dex is the product's personality."
// Three states now:
//
//   idle          64px mic with a brand halo · "type instead" · contextual chips
//   recording     live waveform, elapsed time secondary, one large stop
//   understanding what Dex heard, echoed back as structure · Looks right / Fix
//
// The understanding state is the point: "This is the only place the founder ever
// sees the AI being smart. It must not happen silently behind a 'structuring…'
// banner."
import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowRight, Microphone, Stop, PaperPlaneTilt, Paperclip, Spinner,
  Check, ArrowCounterClockwise, WarningCircle, ListChecks,
} from "@phosphor-icons/react";
import api from "@/lib/api";
import { useAuth } from "../../context/AuthContext";
import { hasPerm } from "@/lib/perms";
import { cn } from "@/lib/utils";
import { useDexCapture, BARS } from "../../hooks/useDexCapture";
import { dueLabel } from "./MobileCard";
import { BottomSheet } from "./BottomSheet";

// §5.6: "Suggestions are contextual to the screen it was opened from — on Money:
// 'record a payment'; on Desk: 'approve everything under ₹10,000'; on CRM: 'call
// Gujarat Cotton'. The four hardcoded strings are identical everywhere and read
// like sample data."
//
// Phrased as things he would actually say out loud, not as query syntax. Kept
// generic on names — a chip naming a contact that this tenant does not have is
// the same sample-data smell in a new costume.
const CHIPS = {
  "/inbox": [
    "Approve everything under ₹10,000",
    "Why is this still waiting on me?",
    "Push today's approvals to tomorrow",
  ],
  "/my-work": [
    "Tell Suresh to ship the indigo lot before Friday",
    "What's running late?",
    "Move my Friday tasks to Monday",
  ],
  "/finance": [
    "Record a payment",
    "Who owes me the most?",
    "Chase everyone over 30 days late",
  ],
  "/crm": [
    "Call my biggest customer",
    "Which customers went quiet this month?",
    "Note that they asked for 45-day credit",
  ],
  "/contacts": [
    "Log a call with them",
    "What did we last agree?",
    "Remind me to follow up next week",
  ],
  "/team": [
    "Who is absent today?",
    "Give Priya the Tirupur order",
    "Approve Anita's leave",
  ],
  "/calendar": [
    "Move tomorrow's meeting to Thursday",
    "What's on this week?",
    "Block Friday afternoon",
  ],
};
const CHIPS_DEFAULT = [
  "Tell Suresh to ship the indigo lot before Friday",
  "Ask Priya where the Krishna Garments payment is",
  "Remind me to check the loom motor tomorrow",
];

/** Longest matching path prefix wins, so /contacts/c_1 gets the contact chips. */
export function chipsFor(pathname = "") {
  const key = Object.keys(CHIPS)
    .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return CHIPS[key] || CHIPS_DEFAULT;
}

const STATUS_COPY = {
  queued: "Sending…",
  transcribing: "Writing down what you said…",
  structuring: "Working out who does what…",
  slow: "Still working on it.",
  failed: "Dex could not make sense of that.",
};

/**
 * The waveform. 28 bars fed by the AnalyserNode's RMS, oldest on the left, so it
 * scrolls like a tape rather than pulsing in place.
 *
 * §5.6: "Not a timer. A timer says a process is running; a waveform says I am
 * listening to you."
 */
/* KM-3 · LiveWaveform — the ONLY visual element in the voice sheet.
   The founder's brief: no mic icon anywhere in this window, no orb, "some
   baby animated visual element" in the Gemini/ChatGPT idiom that responds to
   the voice. So: a row of rounded bars driven by the live `levels` array from
   useDexCapture while recording, and breathing gently on a staggered CSS
   animation while idle so the surface is alive before you speak rather than a
   dead placeholder waiting to be told what to do.
   White on the ink sheet, not danger-600: red is this app's alert colour and
   "Dex is listening" is not an alert. */
function LiveWaveform({ levels = [], live }) {
  const peak = Math.max(...levels, 0);
  return (
    <div
      data-testid="dex-waveform"
      data-amplitude={peak.toFixed(3)}
      data-live={live ? "1" : "0"}
      aria-hidden="true"
      className="flex h-28 w-full items-center justify-center gap-[5px]"
    >
      {levels.map((v, i) => (
        <span
          key={i}
          className={cn(
            "w-[6px] shrink-0 rounded-full bg-white",
            live ? "transition-[height] duration-75" : "kr-dex-breathe"
          )}
          style={
            live
              ? { height: `${Math.max(6, Math.round(v * 104))}px`, opacity: 0.45 + (i / BARS) * 0.55 }
              : {
                  // Idle: a fixed silhouette that breathes. The delay ladder is
                  // what makes it read as one organism rather than N blinking
                  // bars, and the height curve gives it a centre-weighted shape.
                  height: `${14 + Math.round(Math.sin((i / BARS) * Math.PI) * 30)}px`,
                  animationDelay: `${i * 90}ms`,
                  opacity: 0.4 + (i / BARS) * 0.4,
                }
          }
        />
      ))}
    </div>
  );
}

export function DexSheet({ open, onClose, onRecordingChange, onCaptured }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const canCapture = user?.role === "owner" || hasPerm(user, "voice_capture");
  const [busy, setBusy] = React.useState(false);

  const dex = useDexCapture({ onCaptured, onRecordingChange, watch: true });
  const {
    text, setText, sending, recording, recordSecs, levels, understanding,
    sendText, startRecording, stopRecording, uploadFile, fileRef, reset,
  } = dex;

  // The chips belong to the screen he opened Dex from, so they are read once at
  // open — navigating underneath a sheet is not a thing that happens, and
  // re-reading would let them change while he is looking at them.
  const [chips, setChips] = React.useState(() => chipsFor(location.pathname));
  React.useEffect(() => {
    if (open) {
      setChips(chipsFor(location.pathname));
      reset();
    }
    // location is deliberately not a dependency — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const stage = understanding ? "understanding" : recording ? "recording" : "idle";

  const looksRight = () => {
    reset();
    onClose?.();
    toast.success("On your desk, waiting for you");
  };

  // §5.6's "Fix ↺": the extraction was wrong, so undo it and hand the words back
  // so he can say it better. Rejecting the decision is what undo means here —
  // leaving a wrong decision pending on the Desk would be worse than no capture.
  const fix = async () => {
    const id = understanding?.decisionId;
    const said = understanding?.transcript || "";
    setBusy(true);
    try {
      if (id) await api.post(`/decisions/${id}/reject`);
      reset();
      setText(said);
      toast.success("Undone — say it again and Dex will re-read it");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not undo that — open it on your desk to reject it");
    } finally {
      setBusy(false);
    }
  };

  if (!canCapture) return null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      // The title is the instruction in the idle state, so it is not repeated in
      // the body. §5.4: business language, and never the same words twice.
      title={
        stage === "understanding"
          ? t("dex.understanding", "Here's what Dex heard")
          : stage === "recording"
            ? t("dex.listening", "Listening…")
            : t("dex.prompt", "Tell Dex what to do")
      }
      /* KM-3 — the old subtitle read "Speak, type, or attach. Dex sorts it
         out." Two of those three are gone from this sheet, so the sentence
         was describing a window that no longer exists. */
      description={
        stage === "idle"
          ? t("dex.subtitle_voice", "Just say it. Dex sorts it out.")
          : undefined
      }
      // idle sits at its content height (~45% at 390x844); recording and
      // understanding take the tall sheet (§5.6's ~80%).
      size="auto"
      /* KM-3 — the sheet is a MINIMISED /brain: ink ground, frosted, with the
         same token re-scope the room uses (`dark` means "inside the ink" since
         KR-2), so every caption and control inside reads light-on-dark without
         a single `dark:` variant. One size for both states too — idle and
         recording share a layout now, so the sheet no longer resizes under
         your thumb the moment you start speaking. */
      className="dark border-t-white/10 bg-kr-ink/95 text-white backdrop-blur-2xl"
      data-testid="dex-sheet"
      /* KM-3 — the sheet's footer slot is gone. It rendered a SECOND "Open
         Dex" button (dex-sheet-open-full) in a `bg-card` bar, which on an ink
         sheet painted a white strip across the bottom and gave the founder two
         identical buttons for one action. The one in the body is the keeper:
         it is styled for the ink ground and sits with the voice stage it
         belongs to. */
    >
      <div data-testid="dex-sheet-stage" data-stage={stage} className="contents">
      {stage === "understanding" && (
        <Understanding u={understanding} onLooksRight={looksRight} onFix={fix} busy={busy} />
      )}

      {(stage === "recording" || stage === "idle") && (
        /* KM-3 · THE VOICE STAGE — one surface, two states, no chrome.
           The founder's brief, point by point: this window is voice-only; the
           mic ICON is gone as a visual element (the waveform IS the control,
           and it carries the label for anyone not looking at it); no text
           field and no send button; the only other affordance is Open Dex.
           Idle and recording are the same layout so nothing jumps when you
           start speaking — only the bars change from breathing to reacting,
           and the caption underneath changes what it says. */
        <div className="flex flex-col items-center py-2" data-testid="dex-voice-stage" data-stage={stage}>
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={sending}
            data-testid={recording ? "dex-mic-stop" : "dex-mic-record"}
            aria-label={
              recording
                ? t("dex.stop", "Stop recording")
                : t("dex.record", "Record a voice note for Dex")
            }
            className="w-full rounded-cardlg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50"
          >
            <LiveWaveform levels={levels} live={recording} />
          </button>

          <p className="mt-1 text-sm text-white/70" data-testid="dex-voice-caption">
            {sending
              ? t("dex.thinking", "Dex is thinking…")
              : recording
                ? `${Math.floor(recordSecs / 60)}:${String(recordSecs % 60).padStart(2, "0")} · ${t("dex.tap_finish", "tap to finish")}`
                : t("dex.tap_speak", "Tap to speak")}
          </p>

          {/* The one button. Full width so it is unmistakably the other thing
              you can do here, and it hands off to the full room rather than
              trying to be it. */}
          <button
            type="button"
            onClick={() => { onClose?.(); navigate("/brain"); }}
            data-testid="dex-open-full"
            className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-white text-sm font-semibold text-kr-ink"
          >
            {t("dex.open", "Open Dex")}
            <ArrowRight size={15} weight="bold" aria-hidden="true" />
          </button>
        </div>
      )}

      </div>
    </BottomSheet>
  );
}

export default DexSheet;
