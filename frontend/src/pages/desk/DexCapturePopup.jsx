// PILOT-2 A · DexCapturePopup — one pop-up carries the whole capture.
//
// WHERE THIS COMES FROM. The pilot client, in a voice note: when a lot has been
// said, the whole of it was being poured into the well's small two-line field,
// where it could not be read or edited; and after Dex had read it there was a
// middle screen — "three decisions came out of it, three tasks" — that told him
// nothing and still made him press Review to see the real thing. So: one
// pop-up, three steps, both surfaces.
//
//   1 · What you said   the transcript of a spoken capture, whole and editable
//                       (six lines at least on desktop, the full sheet on a
//                       phone), with what is attached. Next sends it; Discard
//                       throws it away. A TYPED capture skips this step — the
//                       founder has already read what they typed.
//   2 · Dex is reading  the forge, with the stages as they arrive on desktop
//                       and the forge alone on the phone — exactly as the well
//                       used to show them.
//   3 · What Dex made   the counts across the top, and directly under them the
//                       whole of DecisionDialog's breakdown (DecisionPanel —
//                       the same component, not a copy), with Approve, Save as
//                       draft and Reject pinned at the foot.
//
// The endings that are not a decision — nothing to decide, a failure with
// Retry, the slow case — are the last step in the same pop-up, each with the
// one way out it already had.
//
// WHAT THIS FILE DOES NOT OWN. The capture itself — the recording, the
// transcript, the send, the poll, the ending — stays in DeskDexWell's hooks
// (useDexCapture / useDexConversation), exactly where it was. This is only what
// the founder sees of it; the well decides which step is showing and hands the
// words, the files and the handlers down. Closing the pop-up therefore cancels
// nothing: the note keeps being read, the decision still lands in the Desk's
// Decisions column, and opening it again shows where it got to.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, X, WarningCircle, File as FileGlyph } from "@phosphor-icons/react";
import { Close as DialogPrimitiveClose } from "@radix-ui/react-dialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { DecisionPanel } from "../../components/DecisionDialog";
import { GLASS_ICON_BTN, GLASS_PILL, GLASS_SHEET, INK_PILL } from "../../components/karma/glass";
import { decisionCounts, readyLine, stageLabel, OUTCOME_COPY } from "../../lib/dexOutcome";
import { cn } from "../../lib/utils";
import { DexForgeFit } from "../onboarding/DexForge";

const STEP_COPY = {
  said: { n: 1, title: "What you said", hint: "Read it through, change anything Dex heard wrong, then press Next." },
  reading: { n: 2, title: "Dex is reading it", hint: "Working out the decision, the tasks and who does them." },
  made: { n: 3, title: "What Dex made", hint: "Everything this decision creates, before anything is created." },
  nothing: { n: 3, title: OUTCOME_COPY.nothing, hint: "Dex read it and found nothing to decide." },
  failed: { n: 3, title: "That didn't go through", hint: "Nothing was created." },
  slow: { n: 3, title: "Still working on it", hint: "Dex is taking longer than usual." },
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ON A PHONE, THE KEYBOARD MUST NOT COVER WHAT IS BEING EDITED. JOURNEY-1 J13
   (lib/keepFocusedInView) scrolls a focused field back into view when the
   keyboard opens, and it still runs here — but a full-height sheet does not
   scroll, it is the screen. So the sheet takes the height the keyboard LEAVES:
   the visual viewport's, divided by the UI scale because the app is CSS-zoomed
   (hooks/useUiScale) and a height written in CSS is multiplied by that zoom on
   the way to the glass. The field shrinks, the row of buttons rides up with the
   keyboard, and nothing is under it. Desktop is left alone. */
function useKeyboardSafeBox(active) {
  const [box, setBox] = useState(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) { setBox(null); return undefined; }
    const read = () => {
      const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
      const next = { h: Math.round(vv.height / k), top: Math.round(vv.offsetTop / k) };
      setBox((b) => (b && b.h === next.h && b.top === next.top ? b : next));
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, [active]);
  return box;
}

/** A file going with this capture: a preview (the image itself, or a glyph),
 *  its name, and a remove. */
function FileChip({ file, onRemove, disabled }) {
  const isImage = !!file.file && (file.type || "").startsWith("image/");
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!isImage) return undefined;
    const url = URL.createObjectURL(file.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [isImage, file.file]);
  return (
    <li className={cn("flex min-h-11 max-w-full items-center gap-2 rounded-pill py-1 pl-1.5 pr-1 text-sm text-slate-700", GLASS_PILL)}>
      {src
        ? <img src={src} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
        : (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900/[0.06]">
            <FileGlyph size={13} weight="bold" aria-hidden="true" />
          </span>
        )}
      <span className="min-w-0 truncate" title={file.name}>{file.name}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        data-testid="dex-popup-file-remove"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:opacity-40"
      >
        <X size={14} weight="bold" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Step 3's counts: the 5.1 line, and a tile for each thing the decision makes.
 *  Decisions and tasks always (the client named them); the rest as they apply. */
function MadeCounts({ d, userId }) {
  const c = decisionCounts(d);
  const tiles = [
    ["Decisions", 1, true],
    ["Tasks", c.tasks, true],
    ["People", c.people],
    ["Approvals", c.approvals],
    ["Meetings", c.meetings],
    ["Workflows", c.workflows],
  ].filter(([, n, always]) => always || n > 0);
  return (
    <div className="mb-5" data-testid="dex-popup-counts">
      <p data-testid="desk-dex-summary" className="text-[17px] font-semibold leading-snug text-slate-900">
        {readyLine(d, userId)}
      </p>
      <dl className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-6">
        {tiles.map(([label, n]) => (
          <div key={label} className={cn("min-w-0 rounded-2xl px-3 py-2.5", GLASS_PILL)} data-testid={`dex-popup-count-${label.toLowerCase()}`}>
            <dt className="truncate text-[length:var(--text-label)] font-medium text-slate-500">{label}</dt>
            <dd className="mt-1 font-display text-2xl leading-none tabular-nums text-slate-900">{n}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const inkBtn = cn("flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-pill px-5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 focus-visible:ring-offset-2 disabled:opacity-50 lg:h-12 lg:flex-none lg:px-7", INK_PILL);
const glassBtn = cn("flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-pill px-5 text-sm font-medium text-slate-800 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:opacity-50 lg:h-12 lg:flex-none lg:px-6", GLASS_PILL);
const FOOT = "shrink-0 border-t border-slate-900/[0.06] px-5 pt-3 pb-[calc(0.75rem+var(--sa-bottom))] lg:px-7 lg:pb-4";

/**
 * @param {boolean}  open
 * @param {Function} onClose       the pop-up goes away; the capture does not
 * @param {boolean}  phone
 * @param {"said"|"reading"|"made"|"nothing"|"failed"|"slow"} step
 * @param {string}   text          step 1 — the words, which ARE the kept draft
 * @param {Function} onText
 * @param {boolean}  transcribing  step 1 — the recording is still being turned into words
 * @param {Array}    files         step 1 — attached to this capture
 * @param {Function} onRemoveFile
 * @param {boolean}  busy          a send or an upload is on its way
 * @param {Function} onNext        step 1 → 2
 * @param {Function} onDiscard     step 1 — throw the words away
 * @param {string}   sentText      step 2 — what went to Dex
 * @param {string[]} stages        step 2 — the stages the note has reached so far
 * @param {string}   decisionId    step 3
 * @param {string}   userId
 * @param {Function} onSaveDraft   step 3 — PILOT-2 B
 * @param {object}   outcome       the ending: {answer} | {message, href, linkLabel}
 * @param {Function} onRetry       a failure's Retry
 */
export function DexCapturePopup({
  open, onClose, phone = false, step = "said",
  text = "", onText, transcribing = false, files = [], onRemoveFile, busy = false, onNext, onDiscard,
  sentText = "", stages = [],
  decisionId = null, userId, onSaveDraft,
  outcome = null, onRetry,
}) {
  const copy = STEP_COPY[step] || STEP_COPY.said;
  const box = useKeyboardSafeBox(open && phone);
  const fieldRef = useRef(null);
  const closeRef = useRef(null);
  const reduced = prefersReducedMotion();

  /* Where focus lands. On desktop, step 1 puts the caret at the end of what was
     said, ready to add to it; on a phone it does not, because focusing a field
     raises a keyboard over half the words before they have been read once.
     Every other step lands on the close. */
  const focusIn = (e) => {
    e.preventDefault();
    if (step === "said" && !phone && fieldRef.current) {
      const el = fieldRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      return;
    }
    closeRef.current?.focus();
  };
  // The words arrive after the pop-up has opened (a recording is transcribed
  // while step 1 is already on screen): move the caret to them when they land.
  const hadWords = useRef(!!text);
  useEffect(() => {
    if (step !== "said" || phone || transcribing) return;
    if (!hadWords.current && text && fieldRef.current && document.activeElement !== fieldRef.current) {
      const el = fieldRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    hadWords.current = !!text;
  }, [step, phone, transcribing, text]);

  const canNext = !transcribing && !busy && (!!text.trim() || files.length > 0);
  const shown = ["sending", ...stages];

  /* A stray tap outside must not close the pop-up in the middle of reading or
     approving something (KM-28's rule for DecisionDialog). Close, Escape and
     the phone's Back are the ways out, and none of them loses anything: the
     words are a kept draft and the capture carries on. */
  const guardOutside = (e) => e.preventDefault();

  const header = (
    <div className="flex shrink-0 items-start gap-4 border-b border-slate-900/[0.06] px-5 pb-4 pt-5 lg:px-7 lg:pt-6">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2" data-testid="dex-popup-progress">
          <ol className="flex items-center gap-1" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <li key={n} className={cn("h-1 w-6 rounded-full", n <= copy.n ? "bg-slate-900" : "bg-slate-900/15")} />
            ))}
          </ol>
          <span className="text-xs font-medium text-slate-500">Step {copy.n} of 3</span>
        </div>
        <DialogTitle className="text-left text-[22px] font-semibold leading-tight tracking-tight text-slate-900" data-testid="dex-popup-title">
          {copy.title}
        </DialogTitle>
        <DialogDescription className="mt-1 text-left text-sm text-slate-500">{copy.hint}</DialogDescription>
      </div>
      <DialogPrimitiveClose ref={closeRef} data-testid="dex-popup-close"
        aria-label={step === "reading" ? "Close — Dex keeps reading" : "Close"} className={GLASS_ICON_BTN}>
        <X size={16} weight="bold" aria-hidden="true" />
      </DialogPrimitiveClose>
    </div>
  );

  let body = null;
  let foot = null;
  if (step === "said") {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 lg:px-7 lg:py-5">
        {/* .nm-field — the app's own field, with its own focus ring. Six lines
            at the least on desktop, and whatever the sheet has on a phone. It
            is read-only only while the words are still on their way, so
            nothing typed in that gap is overwritten when they land (KM-53). */}
        <textarea
          ref={fieldRef}
          value={text}
          onChange={(e) => onText?.(e.target.value)}
          readOnly={transcribing}
          rows={6}
          aria-label="What you said"
          data-testid="dex-popup-transcript"
          placeholder={transcribing ? "Transcribing what you said…" : "Nothing came through. Type what you decided, or close this and speak again."}
          className={cn(
            "nm-field block min-h-[7.5rem] w-full flex-1 resize-none px-4 py-3 text-[15px] leading-6 text-slate-800 focus:outline-none lg:min-h-[10.5rem] lg:text-base lg:leading-7",
            transcribing ? "animate-pulse placeholder:text-slate-600" : "placeholder:text-slate-400"
          )}
        />
        {files.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">Going with it</p>
            <ul aria-label="Attached files" className="flex flex-wrap gap-2" data-testid="dex-popup-files">
              {files.map((f) => (
                <FileChip key={f.id} file={f} onRemove={() => onRemoveFile?.(f.id)} disabled={busy} />
              ))}
            </ul>
          </div>
        )}
      </div>
    );
    foot = (
      <div className={cn(FOOT, "flex gap-2.5 lg:justify-end")}>
        <button type="button" onClick={onDiscard} data-testid="dex-popup-discard" className={glassBtn}>Discard</button>
        <button type="button" onClick={onNext} disabled={!canNext} data-testid="dex-popup-next" className={inkBtn}>
          {busy ? "Sending…" : "Next"}
        </button>
      </div>
    );
  } else if (step === "reading") {
    body = (
      <div className="flex min-h-0 flex-1 gap-6 px-5 py-4 lg:px-7 lg:py-6" aria-live="polite" data-testid="dex-popup-reading">
        {/* Desktop: what was said and the stages it has passed, beside the
            forge. The phone: the forge alone (ASK-47 — "just use that dex
            forge building animating element in the center"). Under reduced
            motion the forge is not drawn and the stage stands on its own. */}
        {(!phone || reduced) && (
          <div className={cn("flex min-h-0 min-w-0 flex-col", phone ? "flex-1 justify-center" : "lg:w-[46%]")}>
            {!phone && sentText && (
              <blockquote className="kr-scroll-quiet max-h-[12.5rem] overflow-y-auto whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-700" data-testid="dex-popup-sent">
                &ldquo;{sentText}&rdquo;
              </blockquote>
            )}
            <ol className={cn("space-y-2.5", !phone && "mt-5")} aria-label="What Dex is doing">
              {shown.map((s, i) => {
                const current = i === shown.length - 1;
                return (
                  <li key={s} className={cn("flex items-center gap-2.5 text-sm", current ? "font-medium text-slate-900" : "text-slate-500")}>
                    {current ? (
                      <span aria-hidden="true" className="relative grid h-4 w-4 shrink-0 place-items-center">
                        <span className="absolute inset-0 animate-ping rounded-full bg-slate-900/20 motion-reduce:animate-none" />
                        <span className="h-2 w-2 rounded-full bg-slate-900" />
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
        )}
        {!reduced && (
          <DexForgeFit testid="desk-dex-forge" label="Dex is building what you decided" className="min-h-0 min-w-0 flex-1" />
        )}
      </div>
    );
    foot = (
      <div className={cn(FOOT, "flex items-center gap-3")}>
        <p className="min-w-0 flex-1 text-sm text-slate-500">You can close this. Dex keeps reading, and the decision lands in Decisions on the Desk.</p>
        <button type="button" onClick={onClose} data-testid="dex-popup-hide" className={cn(glassBtn, "flex-none px-6")}>Close</button>
      </div>
    );
  } else if (step === "made") {
    /* Step 3 IS the review: the whole of DecisionPanel, whose body scrolls and
       whose actions are pinned under it. Its own body and foot are the
       flex children of this column, so nothing here wraps them. */
    body = decisionId ? (
      <DecisionPanel
        decisionId={decisionId}
        open={open}
        embedded
        onClose={onClose}
        onSaveDraft={onSaveDraft}
        lead={(d) => <MadeCounts d={d} userId={userId} />}
      />
    ) : null;
  } else if (step === "nothing") {
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-7" data-testid="dex-outcome-nothing">
        {outcome?.answer
          ? <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-slate-700">{outcome.answer}</p>
          : <p className="text-[15px] leading-relaxed text-slate-700">Nothing in it needs a decision, so nothing was created.</p>}
      </div>
    );
    foot = (
      <div className={cn(FOOT, "flex lg:justify-end")}>
        <button type="button" onClick={onClose} data-testid="dex-popup-gotit" className={inkBtn}>Got it</button>
      </div>
    );
  } else if (step === "failed") {
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-7" role="alert" data-testid="dex-outcome-failed">
        <p className="flex items-start gap-2 text-[17px] font-semibold leading-snug text-slate-900">
          <WarningCircle size={20} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-rose-600" />
          {/* The reason is the whole point of this ending: it wraps, never truncates. */}
          <span className="min-w-0 break-words" data-testid="dex-outcome-reason">{outcome?.message}</span>
        </p>
        {outcome?.href && (
          <Link
            to={outcome.href}
            onClick={onClose}
            data-testid="dex-outcome-settings"
            className="mt-3 inline-flex min-h-11 w-fit items-center text-sm font-medium text-slate-900 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30"
          >
            {outcome.linkLabel}
          </Link>
        )}
      </div>
    );
    foot = (
      <div className={cn(FOOT, "flex gap-2.5 lg:justify-end")}>
        <button type="button" onClick={onClose} data-testid="dex-popup-notnow" className={glassBtn}>Not now</button>
        <button type="button" onClick={onRetry} disabled={busy} data-testid="dex-outcome-retry" className={inkBtn}>Retry</button>
      </div>
    );
  } else if (step === "slow") {
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-7">
        <p className="text-[15px] leading-relaxed text-slate-700">{OUTCOME_COPY.slow}</p>
      </div>
    );
    foot = (
      <div className={cn(FOOT, "flex lg:justify-end")}>
        <button type="button" onClick={onClose} data-testid="dex-popup-ok" className={inkBtn}>OK</button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent
        /* The same card DecisionDialog is — 70% of the screen from lg, the
           whole of it on a phone — so step 3, which is the decision's own
           content, sits in the frame it always has. On a phone the sheet
           follows the visual viewport (see useKeyboardSafeBox). */
        className={`${GLASS_SHEET} flex max-h-none flex-col gap-0 overflow-hidden p-0 outline-none [&>button.absolute]:hidden focus:outline-none focus-visible:outline-none focus-visible:ring-0
                   left-0 top-0 h-full w-full max-w-none translate-x-0 translate-y-0 rounded-none
                   [padding-top:var(--sa-top)]
                   lg:left-[50%] lg:top-[50%] lg:h-[calc(70vh/var(--ui-scale,1))] lg:w-[calc(70vw/var(--ui-scale,1))]
                   lg:min-w-[52rem] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[1.75rem]
                   lg:[padding-top:0]
                   data-[state=open]:[--tw-enter-translate-x:0] data-[state=open]:[--tw-enter-translate-y:0]
                   data-[state=closed]:[--tw-exit-translate-x:0] data-[state=closed]:[--tw-exit-translate-y:0]
                   lg:data-[state=open]:[--tw-enter-translate-x:-50%] lg:data-[state=open]:[--tw-enter-translate-y:-48%]
                   lg:data-[state=closed]:[--tw-exit-translate-x:-50%] lg:data-[state=closed]:[--tw-exit-translate-y:-48%]`}
        style={box ? { height: box.h, top: box.top } : undefined}
        onPointerDownOutside={guardOutside}
        onInteractOutside={guardOutside}
        onOpenAutoFocus={focusIn}
        data-testid="dex-popup"
        data-step={step}
      >
        {header}
        {body}
        {foot}
      </DialogContent>
    </Dialog>
  );
}

export default DexCapturePopup;
