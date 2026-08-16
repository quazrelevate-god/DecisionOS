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
function LiveWaveform({ levels = [] }) {
  const peak = Math.max(...levels, 0);
  return (
    <div
      data-testid="dex-waveform"
      data-amplitude={peak.toFixed(3)}
      aria-hidden="true"
      className="flex h-24 w-full items-center justify-center gap-[3px]"
    >
      {levels.map((v, i) => (
        <span
          key={i}
          className="w-[6px] shrink-0 rounded-full bg-danger-600 transition-[height] duration-75"
          // 4px floor so silence still reads as a live line rather than a gap.
          style={{ height: `${Math.max(4, Math.round(v * 96))}px`, opacity: 0.35 + (i / BARS) * 0.65 }}
        />
      ))}
    </div>
  );
}

/** One extracted field, with the value carrying the emphasis. */
function Field({ label, value }) {
  if (!value) return null;
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-sm font-semibold">{value}</span>
    </span>
  );
}

/**
 * The understanding card — Dex echoing back what it heard as structure.
 *
 * Everything shown here is read from what the backend actually extracted: the
 * transcript, the decision title, and the tasks it created. Nothing is
 * paraphrased on the client, because a plausible-looking echo that does not
 * match what was stored would be worse than no echo at all.
 */
function Understanding({ u, onLooksRight, onFix, busy }) {
  const working = ["queued", "transcribing", "structuring"].includes(u.status);
  const done = u.status === "done" || (!!u.decision && !working);
  const bad = u.status === "failed";

  return (
    <div data-testid="dex-understanding" data-status={u.status}>
      {/* What he said, always first — it is the thing being confirmed. */}
      {u.transcript ? (
        <blockquote
          data-testid="dex-heard"
          className="rounded-xl border-l-4 border-primary bg-accent px-3.5 py-3 text-[0.9375rem] leading-relaxed"
        >
          “{u.transcript}”
          {u.language && (
            <span className="mt-1 block text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
              heard in {u.language}
            </span>
          )}
        </blockquote>
      ) : (
        <p className="flex items-center gap-2 text-[0.9375rem] text-muted-foreground">
          <Spinner size={18} className="animate-spin" aria-hidden="true" />
          {STATUS_COPY[u.status] || "Listening…"}
        </p>
      )}

      {working && u.transcript && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" data-testid="dex-working">
          <Spinner size={16} className="animate-spin" aria-hidden="true" />
          {STATUS_COPY[u.status]}
        </p>
      )}

      {bad && (
        <p className="mt-3 flex items-start gap-2 text-sm text-danger-700" data-testid="dex-failed">
          <WarningCircle size={18} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0" />
          Say it again and Dex will have another go. Nothing was saved.
        </p>
      )}

      {u.status === "slow" && (
        <p className="mt-3 text-sm text-muted-foreground">
          It is saved either way — it will appear on your desk when it is ready.
        </p>
      )}

      {/* The structure. This is the moment §5.6 is about. */}
      {done && u.decision && (
        <div className="mt-4" data-testid="dex-structured">
          <p className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            Dex turned that into
          </p>
          <div className="mt-2 rounded-xl border border-border bg-card p-3.5">
            <p className="font-heading text-[1.0625rem] font-bold leading-snug tracking-tight">
              {u.decision.title}
            </p>
            {u.decision.summary && u.decision.summary !== u.decision.title && (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-clamp-3">
                {u.decision.summary}
              </p>
            )}

            {u.tasks?.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-border pt-3">
                {u.tasks.map((task) => {
                  const d = dueLabel(task.due_date);
                  return (
                    <li
                      key={task.id}
                      data-testid={`dex-task-${task.id}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                    >
                      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                        <ListChecks size={16} weight="bold" aria-hidden="true" className="shrink-0 translate-y-0.5 text-muted-foreground" />
                        <span className="min-w-0 text-sm font-semibold leading-snug">{task.title}</span>
                      </span>
                      <Field label="for" value={task.assignee_name} />
                      <Field label="by" value={d?.text} />
                    </li>
                  );
                })}
              </ul>
            )}

            {u.summary && (
              <p className="mt-3 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
                {[
                  u.summary.tasks ? `${u.summary.tasks} task${u.summary.tasks === 1 ? "" : "s"}` : null,
                  u.summary.workflows ? `${u.summary.workflows} workflow${u.summary.workflows === 1 ? "" : "s"}` : null,
                  u.summary.meetings ? `${u.summary.meetings} meeting${u.summary.meetings === 1 ? "" : "s"}` : null,
                  u.summary.reminders ? `${u.summary.reminders} reminder${u.summary.reminders === 1 ? "" : "s"}` : null,
                ].filter(Boolean).join(" · ") || "Nothing to assign — filed as a note"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* §5.6: `Looks right ✓` / `Fix ↺`. Only once there is something to judge. */}
      {(done || bad) && (
        <div className="mt-5 flex items-stretch gap-touch-gap">
          <button
            type="button"
            onClick={onLooksRight}
            data-testid="dex-looks-right"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-success-600 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ minHeight: "var(--control-h-lg)" }}
            disabled={busy}
          >
            <Check size={20} weight="bold" aria-hidden="true" />
            Looks right
          </button>
          {done && (
            <button
              type="button"
              onClick={onFix}
              data-testid="dex-fix"
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 text-base font-semibold transition-colors hover:bg-accent disabled:opacity-50"
              style={{ minHeight: "var(--control-h-lg)" }}
            >
              {busy ? <Spinner size={18} className="animate-spin" /> : <ArrowCounterClockwise size={18} weight="bold" aria-hidden="true" />}
              Fix
            </button>
          )}
        </div>
      )}
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
      description={
        stage === "idle"
          ? t("dex.subtitle", "Speak, type, or attach. Dex sorts it out.")
          : undefined
      }
      // idle sits at its content height (~45% at 390x844); recording and
      // understanding take the tall sheet (§5.6's ~80%).
      size={stage === "idle" ? "auto" : "tall"}
      data-testid="dex-sheet"
      footer={
        stage === "idle" ? (
          <button
            type="button"
            data-testid="dex-sheet-open-full"
            onClick={() => {
              onClose?.();
              navigate("/brain");
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border text-base font-semibold transition-colors hover:bg-accent"
            style={{ minHeight: "var(--control-h-md)" }}
          >
            {t("dex.open_full", "Open Dex")}
            <ArrowRight size={18} weight="bold" />
          </button>
        ) : undefined
      }
    >
      <div data-testid="dex-sheet-stage" data-stage={stage} className="contents">
      {stage === "understanding" && (
        <Understanding u={understanding} onLooksRight={looksRight} onFix={fix} busy={busy} />
      )}

      {stage === "recording" && (
        <div className="flex flex-col items-center py-2" data-testid="dex-recording">
          <LiveWaveform levels={levels} />
          {/* Elapsed time small and secondary beneath it (§5.6). */}
          <p
            data-testid="dex-elapsed"
            className="mt-2 text-sm font-semibold tabular-nums text-muted-foreground"
          >
            {Math.floor(recordSecs / 60)}:{String(recordSecs % 60).padStart(2, "0")}
          </p>
          <button
            type="button"
            onClick={stopRecording}
            data-testid="dex-mic-stop"
            aria-label={`Stop recording (${recordSecs} seconds)`}
            className="mt-6 flex h-20 w-20 items-center justify-center rounded-full bg-danger-600 text-white transition-transform active:scale-95"
          >
            <Stop size={32} weight="fill" aria-hidden="true" />
          </button>
          <p className="mt-3 text-sm text-muted-foreground">Tap to finish</p>
        </div>
      )}

      {stage === "idle" && (
        <div data-testid="dex-idle">
          {/* The mic is the hero: 64px, centred, with a brand-tinted halo. */}
          <div className="flex flex-col items-center pb-1 pt-1">
            <button
              type="button"
              onClick={startRecording}
              disabled={sending}
              data-testid="dex-mic-record"
              aria-label={t("dex.record", "Record a voice note for Dex")}
              className="relative flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-brutal-sm transition-transform active:scale-95 disabled:opacity-50"
            >
              <span
                aria-hidden="true"
                className="absolute -inset-3 rounded-full bg-primary/15"
              />
              <span
                aria-hidden="true"
                className="absolute -inset-6 rounded-full bg-primary/[0.07]"
              />
              {sending ? (
                <Spinner size={28} className="animate-spin" />
              ) : (
                <Microphone size={30} weight="fill" aria-hidden="true" />
              )}
            </button>
          </div>

          {/* Typing is the alternative, so it says so rather than sitting there
              as an equal-weight field with a generic placeholder. */}
          <div className="mt-6 flex items-stretch gap-2">
            <input
              data-testid="dex-text-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendText()}
              disabled={sending}
              placeholder={t("dex.type_instead", "type instead…")}
              className="min-w-0 flex-1 rounded-xl border border-input bg-card px-3.5 text-base outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              style={{ minHeight: "var(--control-h-md)" }}
            />
            <button
              type="button"
              onClick={sendText}
              disabled={!text.trim() || sending}
              data-testid="dex-send"
              aria-label={t("dex.send", "Send to Dex")}
              className="flex w-12 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-opacity disabled:opacity-40"
              style={{ minHeight: "var(--control-h-md)" }}
            >
              {sending ? <Spinner size={20} className="animate-spin" /> : <PaperPlaneTilt size={20} weight="bold" />}
            </button>
          </div>

          {/* §5.6: horizontal pills, not a vertical stack of four full-width
              buttons. The row scrolls; §5.2.2's fade mask marks that it does. */}
          <div className="relative mt-4">
            <div
              className="-mx-4 flex gap-touch-gap overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              data-testid="dex-chips"
            >
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-testid="dex-suggestion"
                  onClick={() => setText(c)}
                  className="flex shrink-0 items-center rounded-pill border border-border bg-card px-3.5 text-sm transition-colors hover:bg-accent"
                  style={{ minHeight: "var(--control-h-sm)" }}
                >
                  {c}
                </button>
              ))}
            </div>
            {/* §5.2.2's fade mask. It was at right-[-1rem], which put it past
                the sheet's own edge and therefore off-screen — the row scrolled
                with a hard cut and nothing to say so. */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-card to-transparent"
            />
          </div>

          {/* Attach stays available but demoted — it is the rarest of the three. */}
          <input
            type="file"
            ref={fileRef}
            hidden
            onChange={uploadFile}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending}
            data-testid="dex-file-upload"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            <Paperclip size={18} weight="bold" aria-hidden="true" />
            {t("dex.attach", "Attach a bill or photo")}
          </button>
        </div>
      )}
      </div>
    </BottomSheet>
  );
}

export default DexSheet;
