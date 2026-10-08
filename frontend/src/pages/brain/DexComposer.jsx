/**
 * DEX-R1 (2026-10-08) — the composer on /brain.
 *
 * INK, because it is where you act. The Karma rule is that a surface is light
 * when you are reading it and ink when you are acting on it — the Desk's sheet,
 * the dock — so the one place on this page you DO something is the same black
 * as every other place in the app you do something. The conversation above it
 * is light because it is read.
 *
 * ON THE FLOOR AND IT NEVER MOVES. The bar is docked to the bottom of the page
 * with the thread scrolling beneath it, the convention of every chat surface
 * people already use, Messages on the Mac included. HIG's desktop note
 * (layout › Desktop) warns against controls at the bottom of a WINDOW because
 * people drag windows past the screen edge; that is a native-window concern,
 * and a browser tab's floor is always on screen. Named here because it is a
 * guideline knowingly not followed.
 *
 * THE ORB IS GONE, ITS HONESTY ISN'T. The old page drew a 312px orb whose
 * rings tracked the live microphone level. The level was real (an
 * AnalyserNode in useDexCapture) and worth keeping; the orb was decoration.
 * The same signal now drives a meter inside the bar, where the recording is.
 *
 * WHITE DISCS on ink, like the dock's handle: the control you press is the
 * brightest thing on the bar.
 */
import { useEffect, useRef } from "react";
import {
  Microphone, Stop, ArrowUp, Paperclip, X, NotePencil,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Loader } from "../../components/common";

const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-kr-ink";
const GHOST = cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-35 disabled:hover:bg-transparent", RING);
const DISC = cn("grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-kr-ink transition-[transform,opacity] hover:scale-[1.04] active:scale-95 disabled:opacity-35 disabled:hover:scale-100", RING);

/** The live level, newest on the right. Flat when the mic hears nothing. */
function LevelMeter({ levels }) {
  const N = 32;
  const win = (levels || []).slice(-N);
  const bars = Array.from({ length: N }, (_, i) => win[i - (N - win.length)] ?? 0);
  return (
    <span className="flex h-6 flex-1 items-center gap-[3px]" aria-hidden="true">
      {bars.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-white/80 transition-[height] duration-100"
          style={{ height: `${4 + Math.max(0, Math.min(1, v)) * 20}px` }}
        />
      ))}
    </span>
  );
}

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * @param {object}   capture  useDexCapture's return, passed whole
 * @param {Function} onAsk    (text) => void — Enter and Send go here, to /ask
 * @param {boolean}  thinking an answer is in flight
 */
export function DexComposer({ capture, onAsk, thinking, focusKey }) {
  const {
    text, setText, sending, recording, recordSecs, levels,
    sendText, startRecording, stopRecording, uploadFile, fileRef,
    attachments = [], removeAttachment,
  } = capture;

  const busy = sending || thinking;
  const hasInput = text.trim().length > 0 || attachments.length > 0;

  /* The box grows with what is typed, to a ceiling, rather than scrolling a
     one-line window over a long question. */
  const inputRef = useRef(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  /* Someone who opened Dex came to ask: the cursor is already in the box. It
     comes back there after each answer, ready for the follow-up, and when a
     new conversation starts (focusKey changes). */
  useEffect(() => {
    if (!busy && !recording) inputRef.current?.focus();
  }, [busy, recording, focusKey]);

  const submit = () => {
    if (!hasInput || busy) return;
    const q = text.trim();
    setText("");
    onAsk?.(q);
  };

  return (
    <div data-testid="dex-composer">
      <input
        type="file"
        ref={fileRef}
        hidden
        onChange={uploadFile}
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
      />

      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="rounded-[26px] bg-kr-ink p-2 text-white shadow-[0_22px_48px_-20px_hsl(0_0%_0%/0.55),0_2px_6px_-2px_hsl(0_0%_0%/0.25)]"
      >
        {/* What goes with the next question. Each one can be taken back. */}
        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 px-2 pb-1.5 pt-1" data-testid="dex-attachments" aria-label="Attached files">
            {attachments.map((a) => (
              <li key={a.id} className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full bg-white/10 py-1 pl-2.5 pr-1 text-[13px] text-white/90">
                <Paperclip size={13} className="shrink-0 text-white/60" aria-hidden="true" />
                <span className="truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment?.(a.id)}
                  aria-label={`Remove ${a.name}`}
                  className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/15 hover:text-white", RING)}
                >
                  <X size={11} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy || recording}
            data-testid="dex-attach"
            aria-label="Attach a bill, photo or document"
            title="Attach a bill, photo or document"
            className={GHOST}
          >
            <Paperclip size={19} />
          </button>

          {recording ? (
            /* While recording the box becomes the recording: what is happening,
               the voice it is hearing, and how long it has been. */
            <div className="flex min-h-10 flex-1 items-center gap-3 px-2" data-testid="dex-recording" aria-live="polite">
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-500 opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger-500" />
              </span>
              <span className="text-[15px] font-medium">Listening</span>
              <LevelMeter levels={levels} />
              <span className="text-[14px] tabular-nums text-white/70">{clock(recordSecs)}</span>
            </div>
          ) : (
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              rows={1}
              placeholder={sending ? "Saving your note…" : "Ask about your company"}
              aria-label="Ask Dex"
              data-testid="dex-input"
              className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-6 text-white placeholder:text-white/55 focus:outline-none"
            />
          )}

          {/* Typed capture, kept: Enter asks, this files the same words as a
              note instead. Named in words — an icon alone could not say it. */}
          {hasInput && !recording && (
            <button
              type="button"
              onClick={sendText}
              disabled={busy}
              data-testid="dex-save-note"
              className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-35", RING)}
            >
              <NotePencil size={15} /> Save as note
            </button>
          )}

          {recording ? (
            <button type="button" onClick={stopRecording} data-testid="dex-stop" aria-label={`Stop recording, ${recordSecs} seconds`} className={DISC}>
              <Stop size={16} weight="fill" />
            </button>
          ) : hasInput ? (
            <button type="submit" disabled={busy} data-testid="dex-send" aria-label="Ask Dex" className={DISC}>
              {busy ? <Loader size={18} /> : <ArrowUp size={18} weight="bold" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={busy}
              data-testid="dex-mic"
              aria-label="Record a voice note"
              title="Record a voice note"
              className={DISC}
            >
              {sending ? <Loader size={18} /> : <Microphone size={18} weight="fill" />}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export default DexComposer;
