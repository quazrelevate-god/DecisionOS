/**
 * NM-11 / NM-13 — the Dex stage.
 *
 * WHAT THIS REPLACED. A PageHeader, a three-button segmented strip, and a
 * horizontal capture bar — the layout of a settings screen. Dex is the
 * product's selling point and it looked like a form with a microphone on it.
 *
 * NM-13 — ONE COMPOSER. The page used to carry two: this one (which captured
 * a note) and AskPanel's (which asked a question) — visually identical, one
 * above the other, so the page appeared to be asking the same thing twice.
 * They were not the same: typing here posted to /voice-notes/text, typing
 * there posted to /ask. Collapsing them means picking what a typed line MEANS,
 * and for a page whose job is conversation the answer is: it is a question.
 * So Enter and Send go to /ask. The mic and the paperclip still capture — a
 * spoken line and a dropped bill are naturally "tell Dex", not "ask Dex" — and
 * the note button keeps typed capture reachable in one click rather than
 * deleting the capability along with the duplicate field.
 *
 * THE ORB IS REAL. It is driven by `levels` out of useDexCapture, which are
 * sampled from an AnalyserNode on the live microphone stream — so the rings
 * move because of the voice, not on a timer. When nothing is recording it
 * breathes on a slow CSS cycle instead, which is the one place a loop is
 * honest: there is no signal to represent.
 *
 * WHY RINGS AND NOT BARS. A bar meter reads as "recording in progress" — a
 * technical readout. Concentric rings that swell read as something listening.
 * Same data, and the second one is what a founder should feel when the most
 * important surface in the product is waiting on them.
 *
 * COMPACT. Once a conversation exists the orb is no longer the subject of the
 * screen — the answer is. It shrinks to ~55% and the headline goes, so the
 * composer stays put and the thread gets the room.
 */
import { useMemo } from "react";
import {
  Microphone, Stop, PaperPlaneTilt, Paperclip, Sparkle, Spinner, NotePencil,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Concentric rings whose radius tracks the live amplitude.
 *
 * `levels` is the rolling window the hook keeps (oldest -> newest). The newest
 * few samples drive the inner rings and the older ones the outer, so a spoken
 * syllable visibly travels outward instead of every ring pulsing in lockstep.
 */
function Orb({ levels, recording, thinking, scale = 1 }) {
  const rings = useMemo(() => {
    const n = 4;
    const win = levels && levels.length ? levels : [];
    return Array.from({ length: n }, (_, i) => {
      // Ring 0 = newest sample, ring 3 = ~3 samples ago.
      const v = win.length ? win[win.length - 1 - i] ?? 0 : 0;
      return Math.max(0, Math.min(1, v));
    });
  }, [levels]);

  const live = recording && rings.some((v) => v > 0.02);
  const px = (n) => Math.round(n * scale);

  // NM-17 — THE ORB NOW RESERVES ITS OWN SPACE.
  //
  // Every ring and the bloom are absolutely positioned, so the only thing in
  // normal flow was the 104px core. The container was therefore 104px tall
  // while the outermost ring is 264px across — 80px of it hung below the box
  // and landed on top of "Ask Dex anything". That is the overlap: not a
  // z-index problem, a layout one. The box is now sized to the largest ring
  // at full amplitude (264 x 1.14 = 301), so everything after it starts
  // BELOW the orb instead of inside it.
  //
  // The bloom is deliberately allowed to exceed the box. It is a blurred
  // gradient with no edge, so containing it would only make the glow smaller
  // for no gain in clearance.
  const box = px(312);

  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: box, height: box }}
      aria-hidden="true"
    >
      {/* Atmospheric bloom. Scales with the loudest current ring so the whole
          stage brightens when someone speaks. */}
      <div
        className="absolute rounded-full blur-3xl transition-opacity duration-300"
        style={{
          width: px(320), height: px(320),
          background: "radial-gradient(circle, hsl(var(--brand-500) / 0.30), transparent 65%)",
          // NM-18: idle 0.30 was set against white, where a soft glow is
          // plenty. On the navy sky it disappeared into the page's own
          // gradient, so the core lost the halo that made it read as lit.
          opacity: recording ? 0.55 + rings[0] * 0.45 : 0.45,
        }}
      />

      {/* The reactive rings. transform only — no layout, no paint thrash. */}
      {rings.map((v, i) => (
        <span
          key={i}
          className={cn(
            "absolute rounded-full border transition-transform duration-100 ease-out",
            // NM-18: a 15%-opacity indigo hairline is legible on white and
            // invisible on a navy ground — the rings were there in the DOM and
            // gone to the eye. Roughly doubled in dark only.
            recording
              ? "border-primary/30 dark:border-primary/55"
              : "border-primary/15 dark:border-primary/28",
            !recording && "dex-breathe"
          )}
          style={{
            width: px(132 + i * 44),
            height: px(132 + i * 44),
            transform: `scale(${1 + v * (0.14 - i * 0.02)})`,
            animationDelay: `${i * 260}ms`,
          }}
        />
      ))}

      {/* Core. The one solid object — everything else is atmosphere. */}
      <span
        className="relative grid place-items-center rounded-full nm-raised transition-transform duration-100"
        style={{
          width: px(104), height: px(104),
          transform: `scale(${1 + (recording ? rings[0] * 0.10 : 0)})`,
        }}
      >
        {thinking
          ? <Spinner size={px(30)} className="animate-spin text-primary" />
          : <Sparkle size={px(34)} weight="fill" className={cn("text-primary transition-opacity", live ? "opacity-100" : "opacity-70")} />}
      </span>
    </div>
  );
}

/**
 * @param {object}   capture   the useDexCapture return, passed whole
 * @param {Function} onAsk     (text) => void — the ONE send path, goes to /ask
 * @param {boolean}  thinking  an answer is in flight
 * @param {boolean}  compact   a conversation already exists; give it the room
 * @param {string}   status    the line under the orb
 * @param {node}     trailing  quiet page-level actions (Documents, new thread)
 */
export function DexStage({ capture, onAsk, thinking, compact = false, status, trailing }) {
  const {
    text, setText, sending, recording, recordSecs, levels,
    sendText, startRecording, stopRecording, uploadFile, fileRef,
  } = capture;

  const busy = sending || thinking;
  const submit = () => {
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    onAsk?.(q);
  };

  return (
    <div className="relative" data-testid="dex-stage">
      {/* The page's own atmosphere. Sits behind content, never takes a
          pointer, and is the reason /brain reads as a different surface
          rather than the same app in a different card. */}
      {/* NM-17: anchored to the ORB, not to the top of the page. It used to
          start at -top-10 with a fixed 520px height, which was right when the
          orb sat near the top; now that the stage centres, a glow pinned to
          the top edge would be lighting empty canvas above the thing it is
          supposed to be lighting. */}
      <div
        className="pointer-events-none absolute -inset-x-8 inset-y-0 -z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(46% 34% at 50% 30%, hsl(var(--brand-500) / 0.16), transparent 72%)," +
            "radial-gradient(34% 26% at 84% 14%, hsl(var(--brand-400) / 0.10), transparent 72%)",
        }}
      />

      {/* NM-17: with nothing asked yet the stage is the whole screen, so it
          centres in the canvas instead of clinging to the top edge with 400px
          of dead space under it. The moment a thread exists it releases the
          height and the answer takes the page. */}
      <div
        className={cn(
          "flex flex-col items-center",
          compact ? "pt-1 pb-1" : "justify-center min-h-[calc(100vh-16rem)] py-6"
        )}
      >
        <Orb
          levels={levels}
          recording={recording}
          thinking={busy}
          scale={compact ? 0.55 : 1}
        />

        {!compact && (
          <>
            <p className="mt-2 text-[28px] leading-tight font-display" data-testid="dex-stage-status">
              {recording ? "Listening…" : busy ? "Working on it…" : "Ask Dex anything"}
            </p>
            <p className="mt-2.5 text-sm text-muted-foreground">
              {recording
                ? `${recordSecs}s — tap stop when you're done`
                : status || "Speak, type, or drop a bill. Dex remembers everything."}
            </p>
          </>
        )}

        {/* Composer. One row, and the mic and Send share the trailing slot so
            there are never two primary buttons competing. */}
        <div
          className={cn(
            "w-full max-w-2xl flex items-end gap-1 rounded-cardlg nm-raised p-2",
            compact ? "mt-4" : "mt-9"
          )}
          data-testid="dex-stage-composer"
        >
          <input type="file" ref={fileRef} hidden onChange={uploadFile}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || recording}
            data-testid="dex-stage-attach"
            aria-label="Attach a bill or photo"
            title="Attach a bill or photo"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-muted-foreground transition-shadow hover:shadow-nm-sm active:shadow-nm-press disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Paperclip size={19} weight="bold" />
          </button>

          {/* NM-13: typed CAPTURE, kept alive. Enter asks; this logs the same
              line as a note instead. Only offered when there is something to
              log, so the composer is one control wide at rest. */}
          {text.trim() && !recording && (
            <button
              type="button"
              onClick={sendText}
              disabled={busy}
              data-testid="dex-stage-note"
              aria-label="Log this as a note instead of asking"
              title="Log this as a note instead of asking"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-muted-foreground transition-shadow hover:shadow-nm-sm active:shadow-nm-press disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <NotePencil size={19} weight="bold" />
            </button>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={1}
            disabled={recording}
            // Short on purpose: the textarea is rows={1} with no auto-grow, so
            // a placeholder that does not fit WRAPS and gets clipped by the
            // 44px line box. "Ask your company anything…" did exactly that at
            // phone width. The full invitation lives in the subline above.
            placeholder={recording ? "Listening…" : "Ask your company…"}
            data-testid="dex-stage-input"
            className="min-h-11 max-h-40 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-snug placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
          />

          {text.trim() ? (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              data-testid="dex-stage-send"
              aria-label="Ask Dex"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-primary text-primary-foreground shadow-nm-sm transition-opacity hover:opacity-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <PaperPlaneTilt size={18} weight="fill" />
            </button>
          ) : recording ? (
            <button
              type="button"
              onClick={stopRecording}
              data-testid="dex-stage-stop"
              aria-label={`Stop recording, ${recordSecs} seconds`}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-control bg-danger-600 px-3.5 text-white shadow-nm-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Stop size={16} weight="fill" />
              <span className="text-sm font-medium tabular-nums">{recordSecs}s</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={busy}
              data-testid="dex-stage-mic"
              aria-label="Record a voice note"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-primary text-primary-foreground shadow-nm-sm transition-opacity hover:opacity-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Microphone size={19} weight="fill" />
            </button>
          )}
        </div>

        {trailing && <div className="mt-3">{trailing}</div>}
      </div>
    </div>
  );
}

export default DexStage;
