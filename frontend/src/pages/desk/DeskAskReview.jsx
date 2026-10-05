/* ASK · THE REVIEW CARD, the way Decide's already works.
 *
 * 2026-10-05, second pass. The first cut put the composer in the slider — a
 * plus, two mini-buttons and a text field — and the founder threw it out for a
 * reason worth writing down: it made the founder press send TWICE.
 *
 *   "the voice captures when we slide to the left, and when I click the send
 *    button a text field appears and it shows the transcription. But that's
 *    not quite a user flow — users shouldn't click send twice."
 *
 * And worse, once the field had opened there was no way back to the mic: the
 * control had become a keyboard and the voice option was gone.
 *
 * So Ask now does exactly what Decide does, and this is that card:
 *
 *   swipe left        the handle parks left, becomes a send, the mic is live
 *   press send        the capture STOPS DEAD and this card opens IMMEDIATELY
 *   (transcribing)    a pulse where the words will be — the card does not wait
 *                     for the server before it appears, which is the specific
 *                     thing the founder asked to be inverted
 *   the words land    editable, with a plain attach button beside them
 *   press send        the card goes, the question joins the transcript
 *
 * NO SECOND MICROPHONE IN HERE, deliberately and on the founder's instruction:
 * "if we need another voice based input there, we shouldn't allow that — let
 * them use their built-in text to speech in their keyboard." One capture, one
 * review, one send.
 */
import * as React from "react";
import { Paperclip, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { AttachedChip } from "../../components/mobile/DexChat";
import { cn } from "@/lib/utils";

export function DeskAskReview({
  open, loading, draft = "", onDraft, onSend, onCancel, onAttach,
  pendingFiles = [], onRemoveFile, sending = false,
}) {
  const fieldRef = React.useRef(null);

  /* The field grows to the words, to a ceiling, then scrolls — the same rule
     the Desk's own composer uses, so a long dictation is readable without the
     card swallowing the screen. */
  React.useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el || !open) return;
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 22;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const max = Math.round(line * 7 + pad);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [draft, open, loading]);

  /* Focus lands on the words the moment they arrive, not while the pulse is
     still running — a keyboard opening over an empty box reads as a failure. */
  React.useEffect(() => { if (open && !loading && draft) fieldRef.current?.focus(); }, [open, loading, draft]);

  if (!open) return null;
  const canSend = !!draft.trim() || pendingFiles.length > 0;

  return (
    /* FIXED, at the Decide pop-up's own layer (9560) — above the page and the
       dock, below the dialogs. The Desk's board is not a positioned ancestor
       and making it one to host this would move a sheet that four other things
       measure. */
    /* role="dialog" + data-state="open" is not decoration: it is the hook the
       app already uses to make the dock and the Dex circle step aside
       (index.css, "the dock... step aside while a modal dialog is open"). They
       sit at z 10000 and would otherwise cover this card's own Send — which
       they did, caught by a click that could not land. */
    <div
      className="fixed inset-0 z-[9560] flex items-end"
      data-testid="desk-ask-review"
      role="dialog"
      aria-modal="true"
      data-state="open"
      aria-label="Review what to ask Dex"
    >
      {/* The sheet behind it stays visible and inert: this is a card ON the
          conversation, not a screen instead of it. */}
      <button
        type="button"
        aria-label="Discard this and go back"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/45"
        data-testid="desk-ask-review-scrim"
      />
      <div className="kr-pop relative m-2 w-full rounded-[1.6rem] p-3" data-testid="desk-ask-review-card">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-medium text-foreground/60">
            {loading ? "Writing down what you said…" : "Send this to Dex"}
          </span>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Discard"
            data-testid="desk-ask-review-close"
            className="grid h-10 w-10 place-items-center rounded-full text-foreground/60 hover:bg-black/5"
          >
            <X size={17} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {loading ? (
          /* THE PULSE, NOT A SPINNER. It stands exactly where the words will
             be and is the same height, so nothing jumps when they arrive. */
          <div className="space-y-2 px-1 py-2" aria-live="polite" aria-busy="true" data-testid="desk-ask-review-loading">
            <div className="ds-skeleton h-4 w-11/12 rounded-control" />
            <div className="ds-skeleton h-4 w-9/12 rounded-control" />
            <div className="ds-skeleton h-4 w-6/12 rounded-control" />
          </div>
        ) : (
          <div className="nm-field flex min-w-0 items-center overflow-hidden rounded-[1.2rem]">
            <textarea
              ref={fieldRef}
              rows={2}
              value={draft}
              onChange={(e) => onDraft?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onCancel?.(); } }}
              placeholder="Ask Dex anything…"
              aria-label="What to ask Dex"
              data-testid="desk-ask-review-field"
              className="block min-w-0 flex-1 resize-none bg-transparent px-4 py-3 text-[15px] leading-6 text-foreground placeholder:text-foreground/45 focus:outline-none [scrollbar-width:none]"
            />
          </div>
        )}

        {/* What is going with it. Above the buttons, as it is everywhere else. */}
        {pendingFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="desk-ask-review-files">
            {pendingFiles.map((f) => (
              <AttachedChip key={f.id} file={f} onRemove={() => onRemoveFile?.(f.id)} />
            ))}
          </div>
        )}

        {/* A PLAIN PAPERCLIP, not a plus that opens a menu — the founder's
            words: "that attach function should be a straight away attach
            button, not a plus icon or something, just like how it's there in
            the decide section". */}
        <div className="mt-2.5 flex items-center gap-2.5">
          <button
            type="button"
            onClick={onAttach}
            aria-label="Attach a file"
            data-testid="desk-ask-review-attach"
            className="kr-pop grid h-14 w-14 shrink-0 place-items-center rounded-full"
          >
            <Paperclip size={20} weight="bold" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend || loading || sending}
            data-testid="desk-ask-review-send"
            className={cn(
              "flex h-14 flex-1 items-center justify-center gap-2 rounded-pill px-5 text-sm font-semibold",
              "bg-kr-ink text-white disabled:opacity-40"
            )}
          >
            <PaperPlaneTilt size={18} weight="bold" aria-hidden="true" />
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeskAskReview;
