import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, PresenceContext, motion } from "framer-motion";
import {
  Plus, X, Paperclip, Camera, Keyboard, Microphone, CircleNotch, Check, Sparkle, WarningCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { ENDING_STATUSES, OUTCOME_COPY, isReading, stageLabel } from "@/lib/dexOutcome";
// ASK-34 A3 — the same picture the founder met at signup, and the same one the
// desktop well draws while it reads. DexForgeFit scales it to the box it is
// given; see the note beside it.
import { DexForgeFit } from "@/pages/onboarding/DexForge";
import { DexFailureNotice } from "./DexFailureNotice";
import { useBackDismiss } from "@/hooks/useBackDismiss";

// KM-23 · DexChat — Dex as a conversation, over the page you were on.
//
// WHAT THIS REPLACED. DexSheet: one black card that appeared when a capture
// finished, showed what Dex understood, and had to be dismissed. It was a
// receipt, not a conversation — there was nowhere to reply, nowhere to ask a
// follow-up, and the whole /brain page's abilities (ask a question, attach a
// document, type instead of speak) lived on a different screen entirely.
//
// THE SURFACE. Glass over the live page, not a wall: the page behind is dimmed
// and blurred so it stays legible as context. Messages stack upward with the
// newest at the bottom, Dex on the left in ink and you on the right in light
// glass, each arriving with a short spring so a reply reads as landing rather
// than appearing.
//
// KM-26 — NO COMPOSER HERE ANY MORE. The first cut drew its own rounded bar
// with a plus, a wave and a mic inside it, floating just above the app's
// existing dock. The founder's correction: the app already has a bar in
// exactly that place with exactly that material, and it should BECOME Dex —
// the four destinations step aside, the bar draws the wave or turns into a
// text field, and the FAB beside it switches between microphone and send.
// Drawing a second bar over the first was solving a problem that did not exist.
//
// So this component is now only the transcript and the plus. The plus sits
// clear of both the dock and the newest line — bottom-left, on the dock's
// baseline — and its three actions (type, attach, photo) lift upward from it.
//
// WIRING, all of it already on the backend:
// The conversation itself (log, ask, attach, mode) lives in
// hooks/useDexConversation so the bar, the FAB and this transcript all read the
// same state — see the note there.
const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 };

/* Dex answers in light markdown — "**33 overdue tasks**" comes back from /ask
   exactly like that. Rendering the raw string printed the asterisks, so bold
   spans are split out here. Deliberately just bold: a full markdown renderer
   is a dependency and an XSS surface for one emphasis mark, and the endpoint
   does not send links, tables or images. */
function richText(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

/* ASK-33 Phase 4 — A DECIDE ENDING, AS A MESSAGE.
   A capture ends one of three ways (plan 1.4, 5.1, 5.2) and the ending arrives
   as a Dex turn that knows which, drawn in the bubble every turn already has.
   Not a state the sheet switches into — that is the receipt card KM-23 replaced,
   and the ghost card with it — and not a result pinned under the transcript,
   where it would sit on the newest line, the plus and the dock. The words are
   lib/dexOutcome's, the Desk well's own, so a failure reads the same sentence on
   both surfaces. Each ending keeps the capture it came from, so Retry on an
   older one re-sends that one. */
const ACTION = "flex h-11 items-center rounded-pill px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40";
// bg-[#fff]/text-kr-ink for the reason the white bubble gives below (KM-51).
// Phase 5 — Review and Retry commit, so they take the 56px tier; Got it and
// Not now hold the 44px floor (MPWA-01 §5.1).
const ACTION_MAIN = cn(ACTION, "h-14 min-h-touch-lg px-6 bg-[#fff] font-semibold text-kr-ink");
const ACTION_QUIET = cn(ACTION, "bg-white/10 font-medium text-white hover:bg-white/20");

function Outcome({ o, onReview, onRetry, onDismiss, retryDisabled }) {
  if (o.kind === "ready") {
    return (
      <div data-testid="dex-outcome-ready">
        <p className="text-[15px] font-semibold leading-snug text-white">{o.headline}</p>
        {o.lines?.length > 0 && (
          <p className="mt-1.5 whitespace-pre-line break-words text-white/75">{o.lines.join("\n")}</p>
        )}
        {o.decisionId && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" data-testid="dex-outcome-review" onClick={() => onReview(o.decisionId)} className={ACTION_MAIN}>
              Review
            </button>
          </div>
        )}
      </div>
    );
  }
  if (o.kind === "nothing") {
    // Not an error, and it must not look like one: plain words, one way out.
    return (
      <div data-testid="dex-outcome-nothing">
        <p className="text-[15px] font-semibold leading-snug text-white">{OUTCOME_COPY.nothing}</p>
        {o.answer && <p className="mt-1.5 whitespace-pre-line break-words text-white/75">{o.answer}</p>}
        <div className="mt-3 flex">
          <button type="button" data-testid="dex-outcome-dismiss" onClick={onDismiss} className={ACTION_QUIET}>Got it</button>
        </div>
      </div>
    );
  }
  return (
    <div data-testid="dex-outcome-failed" role="alert">
      <p className="flex items-start gap-2 text-[15px] font-semibold leading-snug text-white">
        <WarningCircle size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-rose-300" />
        {/* The reason is the whole point of this ending: it wraps, never truncates. */}
        <span data-testid="dex-outcome-reason" className="min-w-0 break-words">{o.message}</span>
      </p>
      {o.href && (
        <Link
          to={o.href}
          replace
          onClick={onDismiss}
          data-testid="dex-outcome-settings"
          className="mt-2 inline-flex items-center text-white underline underline-offset-4"
        >
          {o.linkLabel}
        </Link>
      )}
      {/* Once retried, the new attempt speaks for itself further down. */}
      {!o.spent && (
        <div className="mt-3 flex flex-wrap gap-2">
          {o.retry && (
            <button type="button" data-testid="dex-outcome-retry" onClick={onRetry} disabled={retryDisabled} className={ACTION_MAIN}>
              Retry
            </button>
          )}
          <button type="button" data-testid="dex-outcome-dismiss" onClick={onDismiss} className={ACTION_QUIET}>Not now</button>
        </div>
      )}
    </div>
  );
}

/** One turn in the transcript. */
function Bubble({ m, index }) {
  const mine = m.role === "user";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING, delay: Math.min(index * 0.02, 0.1) }}
      className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-relaxed",
          /* A bubble is normally as wide as its words. The reading turn holds a
             picture that is sized as a FRACTION of the message area, so it needs
             that area to be a real width rather than one derived from its own
             content — without this the bubble shrank to the stage text and took
             the forge down with it (measured: a 120px bed in a 152px bubble). */
          m.reading && "w-[85%]",
          mine
            /* KM-51 — SOLID white, not the translucent frost. Founder: "the
               chat colour for the AI side is black and the human user side is
               transparent white, I want it in solid white." They are right that
               it read as unfinished: the pair only works as a pair, and a
               translucent bubble opposite an opaque one looks like one of them
               failed to load rather than like two speakers. */
            /* bg-[#fff]/text-kr-ink, not bg-white/text-foreground, for the
               reason the Dex nav pill needed the same: index.css carries a
               legacy `.dark .bg-white { background-color: hsl(var(--card)) }`,
               and this sheet opens over /brain, which runs dark. "Solid white"
               asked for through `bg-white` would have quietly become a dark
               card there — the exact complaint, in a second place. The literal
               colours are immune to it and identical everywhere else. */
            ? "rounded-br-lg bg-[#fff] text-kr-ink shadow-[0_2px_10px_-4px_hsl(230_30%_18%/.35)]"
            : "rounded-bl-lg bg-kr-ink text-white shadow-[0_8px_24px_-12px_hsl(216_28%_18%/.6)]"
        )}
      >
        {!mine && (
          <span className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-white/45">
            <Sparkle size={10} weight="fill" className="text-[hsl(var(--kr-gold))]" /> Dex
          </span>
        )}
        {m.reading ? (
          /* ASK-34 A3 — THE PHONE'S THINKING STATE.
             The desktop's is the expanded well; ASK-33 Phase 4-B made this
             sheet the phone's output surface instead, deliberately, and its
             thinking state was one spinner and four words. It is the forge
             now — the picture the founder met at signup while Dex built their
             company out of what they had just said.
             IN THE PENDING TURN ITSELF, not under the transcript: a panel
             below the log would be a second thing saying what this bubble
             already says, and it would sit on the newest line, the plus and
             the dock — the exact reason ASK-33 Phase 4 put endings in bubbles
             rather than pinning them. Inside the bubble it scrolls with the
             conversation and cannot reach any of them.
             INK IS THE RIGHT GROUND for it: the forge's own note says every
             Dex surface in this app is ink and that is why the bed is, and the
             Dex side of this transcript already is.
             `aspect-[304/184]` is the forge's own ratio, so the box it is
             scaled into is always exactly its shape and the fit is edge to
             edge at any width — 0.89 at 390, 0.81 at 360. */
          <div className="min-w-0">
            <span className="flex items-center gap-2 text-white/70">
              <CircleNotch size={14} className="animate-spin motion-reduce:animate-none" /> {m.text}
            </span>
            {!m.reduceMotion && (
              <DexForgeFit
                testid="dex-chat-forge"
                label="Dex is building what you decided"
                className="mt-3 aspect-[304/184] w-full"
              />
            )}
            {/* THE REAL STAGES STAY, and stay the truth: these are the note's
                own statuses as the poll reports them (ASK-32), in the words
                lib/dexOutcome holds for both surfaces. The animation is the
                picture beside them, never a replacement for them. */}
            <ol className="mt-3 space-y-2" aria-label="What Dex is doing">
              {m.stages.map((s, i) => {
                const current = i === m.stages.length - 1;
                return (
                  <li key={s} className={cn("flex items-center gap-2.5 text-[13px]", current ? "font-medium text-white" : "text-white/55")}>
                    {current ? (
                      <span aria-hidden="true" className="relative grid h-3.5 w-3.5 shrink-0 place-items-center">
                        <span className="absolute inset-0 animate-ping rounded-full bg-white/25 motion-reduce:animate-none" />
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      </span>
                    ) : (
                      <Check size={13} weight="bold" aria-hidden="true" className="shrink-0" />
                    )}
                    {stageLabel(s)}
                  </li>
                );
              })}
            </ol>
          </div>
        ) : m.pending ? (
          <span className="flex items-center gap-2 text-white/70">
            <CircleNotch size={14} className="animate-spin" /> {m.text}
          </span>
        ) : m.outcome && m.outcome.kind !== "slow" ? (
          <Outcome
            o={m.outcome}
            onReview={m.onReview}
            onRetry={m.onRetry}
            onDismiss={m.onDismiss}
            retryDisabled={m.retryDisabled}
          />
        ) : (
          <span className="whitespace-pre-wrap">{richText(m.text)}</span>
        )}
        {/* The real /ask payload is {type, answer, missing_information,
            suggested_questions} — verified against the endpoint, not guessed.
            The follow-ups it hands back are the most useful part of a thin
            answer, so they are tappable rather than decorative. */}
        {m.followups?.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {m.followups.slice(0, 3).map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() => m.onAsk?.(q)}
                className="rounded-pill bg-white/10 px-2.5 py-1 text-left text-[11px] text-white/75 hover:bg-white/20"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {m.missing?.length > 0 && (
          <p className="mt-2 text-[11px] text-white/45">
            Missing: {m.missing.slice(0, 3).join(" · ")}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/**
 * @param {boolean}  open
 * @param {Function} onClose
 * @param {object}   dex     the shared useDexCapture instance from Layout
 */
export function DexChat({ open, onClose, dex, chat, channel }) {
  const { log, busy, mode, setMode, ask, attach, retry, canRetry, pendingFiles = [] } = chat;
  const navigate = useNavigate();
  /* ASK-33 Phase 4 — Review opens the decision the way the phone already opens
     one: /inbox?decision=<id>, which the Desk raises in DecisionDialog, as it
     does for a notification or a pasted link. `replace` swaps out the Back entry
     the open sheet holds (useBackDismiss), so Back from the dialog is not a
     dead step. */
  const onReview = (id) => {
    onClose?.();
    navigate(`/inbox?decision=${encodeURIComponent(id)}`, { replace: true });
  };
  const [plusOpen, setPlusOpen] = React.useState(false);
  const endRef = React.useRef(null);
  const photoRef = React.useRef(null);
  // ASK-32 1.6 — Attach clicked `dex.fileRef`, which no input in this sheet
  // was ever bound to, so it did nothing. It has its own picker now.
  const fileRef = React.useRef(null);
  // Mobile PWA (2026-09-14): Back closes the conversation instead of the page.
  useBackDismiss(open, (o) => { if (!o) onClose?.(); });

  React.useEffect(() => {
    if (log.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log, busy]);

  /* ASK-34 A3 — the stages the note has actually reached, accumulated as the
     poll reports them rather than assumed from a known order: if the pipeline
     ever skips one, printing it as done would be a lie. "sending" is seeded
     because this bubble only exists once the POST has returned, so that step is
     already behind us — the same first line the desktop well draws.
     Cleared when the note ends, so the next capture starts from nothing. */
  const reading = isReading(dex);
  const stage = dex?.understanding?.status;
  const [stages, setStages] = React.useState([]);
  React.useEffect(() => {
    if (!stage || ENDING_STATUSES.includes(stage)) return;
    setStages((s) => (s.includes(stage) ? s : [...s, stage]));
  }, [stage]);
  React.useEffect(() => { if (!reading) setStages([]); }, [reading]);
  // Read at render: the forge is not drawn at all under prefers-reduced-motion,
  // and the stage text stands alone.
  const reduceMotion = typeof window !== "undefined"
    && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /* The three ways in that are not the microphone. "Type" flips the DOCK into
     a text field rather than opening a field here — same bar, different mode. */
  const ACTIONS = [
    /* KM-51 — THE ICON FOLLOWS WHAT THE BUTTON WILL DO, not what mode you are
       in. It was always a keyboard, so in type mode it offered "Type" while
       actually switching back to voice — the founder could not tell it was the
       mic toggle until they pressed it. Now it shows a microphone and says
       Speak while typing, and a keyboard and says Type while not. */
    mode === "type"
      ? { key: "type", icon: Microphone, label: "Speak", onClick: () => { setMode("voice"); setPlusOpen(false); } }
      : { key: "type", icon: Keyboard, label: "Type", onClick: () => { setMode("type"); setPlusOpen(false); } },
    { key: "file", icon: Paperclip, label: "Attach", onClick: () => { fileRef.current?.click(); setPlusOpen(false); } },
    { key: "photo", icon: Camera, label: "Photo", onClick: () => { photoRef.current?.click(); setPlusOpen(false); } },
  ];


  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="dex-chat"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          /* z BELOW the dock (10000) and the FAB, deliberately. The founder's
             words were "behind that app bar we should dim the background" —
             the bar and the button are the composer now, so dimming over them
             would grey out the very controls the screen is for. Above the page
             it is dimming, below the controls it serves. */
          className="lg:hidden fixed inset-0 z-[9990] flex flex-col bg-black/25 backdrop-blur-xl"
        >
          {/* Tapping the dimmed page behind closes — the standard way out of a
              sheet, kept because the X is at the top and thumbs are at the
              bottom. */}
          <button
            type="button"
            aria-label="Close Dex"
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-default"
            tabIndex={-1}
          />

          <div className="relative flex min-h-0 flex-1 flex-col pt-safe">
            <div className="flex items-center justify-between px-4 py-3">
              {/* KM-54 — the header states WHICH Dex. The two doors have
                  different consequences (one answers, one creates a decision
                  and its tasks), so the surface has to keep saying which one
                  you are in. ASK-33 Phase 4: the door is no longer picked on a
                  screen before this one but by where you came from — the FAB
                  opens Ask, the Desk's Dex well opens Decide — and it is just
                  as invisible once you start typing. */}
              <span className="flex items-center gap-2 text-sm font-semibold text-white drop-shadow">
                <Sparkle size={14} weight="fill" className="text-[hsl(var(--kr-gold))]" /> Dex
                {channel && (
                  <span className="rounded-pill bg-white/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">
                    {channel === "decide" ? "Decide" : "Ask"}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={onClose}
                data-testid="dex-chat-close"
                aria-label="Close"
                className="kr-pop grid h-10 w-10 place-items-center rounded-full"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            {/* Transcript. Bottom-anchored so the newest turn sits just above
                the composer and older ones stack away upward. */}
            {/* ASK-33 Phase 4 — FIX: closing could leave the sheet in the page,
                invisible and still taking every tap. Each `layout` bubble is a
                presence child of the sheet's exit, and framer-motion (11.18)
                holds that exit until the bubble's layout animation completes;
                close while one is still settling — an answer or an ending just
                landed, a Retry just reflowed the transcript — and the
                completion never arrives, so the sheet is never removed. It
                reproduced four times in four on the Ask path, with no ASK-33
                code involved. The bubbles fade with the sheet regardless, so a
                null presence context stops them holding its exit and nothing on
                screen changes. */}
            <PresenceContext.Provider value={null}>
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-y-auto px-4 pb-3">
              {log.length === 0 && (
                <div className="pb-6 text-center">
                  <p className="text-sm text-white/70 drop-shadow">
                    {channel === "decide"
                      ? "Say or type the decision."
                      : "Ask about anything in your workspace."}
                  </p>
                  <p className="mt-1 text-xs text-white/45">
                    {channel === "decide"
                      ? "Dex lines up the tasks for approval. Nothing is created until it's approved."
                      : "Dex answers from your data. Nothing is created."}
                  </p>
                </div>
              )}
              {log.map((m, i) => (
                <Bubble
                  key={m.id}
                  m={{
                    ...m,
                    /* Only the LAST reading turn is live: an older one from a
                       capture that has already ended is just the sentence it
                       was. `m.reading` marks the turn (useDexConversation);
                       `reading` is whether a note is being followed right now. */
                    reading: m.reading && reading && i === log.length - 1,
                    stages: ["sending", ...stages],
                    reduceMotion,
                    onAsk: ask,
                    onReview,
                    onDismiss: onClose,
                    onRetry: () => retry(m.outcome?.retry, m.id),
                    retryDisabled: busy || !canRetry,
                  }}
                  index={i}
                />
              ))}
              {busy && <Bubble m={{ role: "dex", text: "Thinking…", pending: true }} index={log.length} />}
              {pendingFiles.length > 0 && (
                <p data-testid="dex-attached" className="self-end rounded-pill bg-white/15 px-3 py-1 text-[11px] text-white/85">
                  <Paperclip size={11} weight="bold" className="mr-1 inline" aria-hidden="true" />
                  {pendingFiles.map((f) => f.name).join(", ")}
                </p>
              )}
              <div ref={endRef} />
            </div>
            </PresenceContext.Provider>

            {/* ASK-33 Phase 5 — a failed Dex capture that must stay until
                dismissed sits here while the sheet is open: in the flow,
                between the transcript and the plus, so it covers neither. */}
            <DexFailureNotice placement="inline" className="mx-4 mb-3" />

            {/* KM-26 · the plus, and only the plus.
                It sits on the DOCK's baseline, clear of the bar (which is now
                the composer) and clear of the newest line of the transcript
                above it. Its actions lift upward, never over what you are
                reading.
                The bottom padding clears the DOCK, which is 64px tall sitting
                on its own safe-area offset — measured, because `pb-safe-4` put
                the plus straight on top of the bar (plus 768-812 against a dock
                at 732-796) and half of it off the bottom of the screen.

                KM-53 — it moved from the left edge to the FAB's centre line, on
                the founder's call. `items-end` puts it on the right and
                `.app-plus-on-fab` (index.css, beside .app-fab-right) does the
                centring; the menu follows it over so the pills still hang off
                the button that opened them rather than across the screen. */}
            <div className="relative flex flex-col items-end px-4 pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))]">
              <AnimatePresence>
                {plusOpen && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute bottom-full right-4 mb-3 flex flex-col items-end gap-2"
                  >
                    {ACTIONS.map((a, i) => {
                      const Icon = a.icon;
                      return (
                        <motion.button
                          key={a.key}
                          type="button"
                          data-testid={`dex-action-${a.key}`}
                          onClick={a.onClick}
                          initial={{ opacity: 0, y: 14, scale: 0.8 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.85 }}
                          transition={{ ...SPRING, delay: (ACTIONS.length - 1 - i) * 0.045 }}
                          className="kr-frost flex h-11 items-center gap-2.5 rounded-pill pl-3 pr-4 text-sm font-medium"
                        >
                          <Icon size={17} weight="bold" aria-hidden="true" />
                          {a.label}
                        </motion.button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="button"
                data-testid="dex-plus"
                aria-label={plusOpen ? "Hide options" : "More ways to talk to Dex"}
                aria-expanded={plusOpen}
                onClick={() => setPlusOpen((v) => !v)}
                className="app-plus-on-fab kr-frost grid h-11 w-11 place-items-center rounded-full"
              >
                <motion.span animate={{ rotate: plusOpen ? 45 : 0 }} transition={SPRING} className="grid place-items-center">
                  <Plus size={19} weight="bold" />
                </motion.span>
              </button>
            </div>
          </div>

          
          {/* Photo goes through the same /files endpoint as an attachment; only
              the picker differs (`capture` asks the OS for the camera). */}
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; attach(f, "Photo"); }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            className="hidden"
            data-testid="dex-attach-input"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; attach(f, "File"); }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default DexChat;
