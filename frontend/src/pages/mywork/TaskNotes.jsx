/* Notes — the task view's scratch pad (founder, 2026-10-29: "replace the
 * details section with a notes section — an empty note-taking space that
 * stays on the client side, just for their convenience, with voice-to-text
 * as well as typing").
 *
 * It is the person's own and nobody else's: kept on this device only
 * (localStorage, per person and per task), never sent to the server, never on
 * the task's timeline. What goes to the team is an update (the slider's left
 * end). Saved as it is typed; the microphone dictates into it through the
 * same /transcribe the app's other dictation buttons use.
 */
import { useEffect, useRef, useState } from "react";
import { LockSimple, Trash } from "@phosphor-icons/react";
import { MicDictateButton } from "../../components/MicDictateButton";
import { DRAWER_CARD, DRAWER_FIELD, DRAWER_LABEL, GLASS_PILL } from "../../components/neuglass/glass";

const keyFor = (userId, taskId) => `dos:task-notes:${userId || "anon"}:${taskId}`;

function read(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

export function TaskNotes({ taskId, userId }) {
  const key = keyFor(userId, taskId);
  const [text, setText] = useState(() => read(key));
  const [saved, setSaved] = useState(false);
  const ref = useRef(null);
  useEffect(() => { setText(read(key)); }, [key]);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (text) localStorage.setItem(key, text); else localStorage.removeItem(key);
        setSaved(true);
      } catch { /* storage blocked: the words stay on screen for this visit */ }
    }, 350);
    setSaved(false);
    return () => clearTimeout(id);
  }, [key, text]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(176, el.scrollHeight)}px`;
  }, [text]);

  const dictated = (words) => setText((t) => (t.trim() ? `${t.trimEnd()}\n${words}` : words));

  return (
    <section className={`${DRAWER_CARD} p-4`} data-testid={`task-notes-${taskId}`}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <p className={`${DRAWER_LABEL} mb-0`}>Your notes</p>
        <span className="flex items-center gap-1 text-[11px] text-slate-500">
          <LockSimple size={11} weight="bold" aria-hidden="true" /> Only on this phone
        </span>
      </div>
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)}
        aria-label="Your notes on this task" data-testid={`task-notes-text-${taskId}`}
        placeholder="Jot anything down — numbers, a name to call, what to check tomorrow. It stays on this phone."
        className={`${DRAWER_FIELD} min-h-[11rem] resize-none leading-relaxed`} />
      <div className="mt-3 flex items-center gap-2">
        <MicDictateButton onText={dictated} title="Dictate a note"
          className={`h-12 w-12 shrink-0 rounded-full ${GLASS_PILL}`} />
        <span className="min-w-0 flex-1 text-[12px] text-slate-500" aria-live="polite">
          {text ? (saved ? "Saved on this phone" : "Saving…") : "Tap the mic to speak a note"}
        </span>
        {text && (
          <button type="button" onClick={() => setText("")} data-testid={`task-notes-clear-${taskId}`}
            className="flex h-11 items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-medium text-slate-600 hover:bg-white">
            <Trash size={14} weight="bold" aria-hidden="true" /> Clear
          </button>
        )}
      </div>
    </section>
  );
}

export default TaskNotes;
