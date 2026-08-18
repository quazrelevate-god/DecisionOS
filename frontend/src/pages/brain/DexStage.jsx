/**
 * NM-11 — the Dex stage.
 *
 * WHAT THIS REPLACED. A PageHeader, a three-button segmented strip, and a
 * horizontal capture bar — the layout of a settings screen. Dex is the
 * product's selling point and it looked like a form with a microphone on it.
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
 * The glow is the page's own, so /brain does not look like the rest of the app
 * wearing a different card. It sits behind everything at -z and never
 * intercepts a pointer.
 */
import { useMemo } from "react";
import { Microphone, Stop, PaperPlaneTilt, Paperclip, Sparkle, Spinner } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Concentric rings whose radius tracks the live amplitude.
 *
 * `levels` is the rolling window the hook keeps (oldest -> newest). The newest
 * few samples drive the inner rings and the older ones the outer, so a spoken
 * syllable visibly travels outward instead of every ring pulsing in lockstep.
 */
function Orb({ levels, recording, thinking }) {
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

  return (
    <div className="relative grid place-items-center" aria-hidden="true">
      {/* Atmospheric bloom. Scales with the loudest current ring so the whole
          stage brightens when someone speaks. */}
      <div
        className="absolute rounded-full blur-3xl transition-opacity duration-300"
        style={{
          width: 320, height: 320,
          background: "radial-gradient(circle, hsl(var(--brand-500) / 0.30), transparent 65%)",
          opacity: recording ? 0.55 + rings[0] * 0.45 : 0.30,
        }}
      />

      {/* The reactive rings. transform only — no layout, no paint thrash. */}
      {rings.map((v, i) => (
        <span
          key={i}
          className={cn(
            "absolute rounded-full border transition-transform duration-100 ease-out",
            recording ? "border-primary/30" : "border-primary/15",
            !recording && "dex-breathe"
          )}
          style={{
            width: 132 + i * 44,
            height: 132 + i * 44,
            transform: `scale(${1 + v * (0.14 - i * 0.02)})`,
            animationDelay: `${i * 260}ms`,
          }}
        />
      ))}

      {/* Core. The one solid object — everything else is atmosphere. */}
      <span
        className="relative grid h-[104px] w-[104px] place-items-center rounded-full nm-raised transition-transform duration-100"
        style={{ transform: `scale(${1 + (recording ? rings[0] * 0.10 : 0)})` }}
      >
        {thinking
          ? <Spinner size={30} className="animate-spin text-primary" />
          : <Sparkle size={34} weight="fill" className={cn("text-primary transition-opacity", live ? "opacity-100" : "opacity-70")} />}
      </span>
    </div>
  );
}

/**
 * @param {object}   capture  the useDexCapture return, passed whole
 * @param {string}   status   the line under the orb
 * @param {node}     tabs     the sub-view switcher, rendered small and quiet
 */
export function DexStage({ capture, status, tabs, onSend }) {
  const {
    text, setText, sending, recording, recordSecs, levels,
    sendText, startRecording, stopRecording, uploadFile, fileRef,
  } = capture;

  const submit = () => { sendText(); onSend?.(); };

  return (
    <div className="relative" data-testid="dex-stage">
      {/* The page's own atmosphere. Sits behind content, never takes a
          pointer, and is the reason /brain reads as a different surface
          rather than the same app in a different card. */}
      <div
        className="pointer-events-none absolute -inset-x-8 -top-10 h-[520px] -z-10"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, hsl(var(--brand-500) / 0.14), transparent 70%)," +
            "radial-gradient(40% 40% at 85% 25%, hsl(var(--brand-400) / 0.10), transparent 70%)",
        }}
      />

      <div className="flex flex-col items-center pt-8 pb-2">
        <Orb levels={levels} recording={recording} thinking={sending} />

        <p className="mt-7 text-2xl font-display" data-testid="dex-stage-status">
          {recording ? "Listening…" : sending ? "Working on it…" : "Ask Dex anything"}
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {recording
            ? `${recordSecs}s — tap stop when you're done`
            : status || "Speak, type, or drop a bill. Dex remembers everything."}
        </p>

        {/* Composer. One row, and the mic and Send share the trailing slot so
            there are never two primary buttons competing. */}
        <div
          className="mt-7 w-full max-w-2xl flex items-end gap-2 rounded-cardlg nm-raised p-2"
          data-testid="dex-stage-composer"
        >
          <input type="file" ref={fileRef} hidden onChange={uploadFile}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending || recording}
            data-testid="dex-stage-attach"
            aria-label="Attach a bill or photo"
            title="Attach a bill or photo"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-control text-muted-foreground transition-shadow hover:shadow-nm-sm active:shadow-nm-press disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Paperclip size={19} weight="bold" />
          </button>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            rows={1}
            disabled={recording}
            placeholder={recording ? "Listening…" : "Ask, or tell Dex what happened…"}
            data-testid="dex-stage-input"
            className="min-h-11 max-h-40 flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-snug placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
          />

          {text.trim() ? (
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              data-testid="dex-stage-send"
              aria-label="Send"
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
              disabled={sending}
              data-testid="dex-stage-mic"
              aria-label="Record a voice note"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-primary text-primary-foreground shadow-nm-sm transition-opacity hover:opacity-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Microphone size={19} weight="fill" />
            </button>
          )}
        </div>

        {tabs && <div className="mt-6">{tabs}</div>}
      </div>
    </div>
  );
}

export default DexStage;
