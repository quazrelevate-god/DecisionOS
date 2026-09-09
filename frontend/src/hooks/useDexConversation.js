import { useCallback, useEffect, useRef, useState } from "react";
import api from "../lib/api";

// KM-26 · the Dex conversation, lifted out of the view.
//
// WHY IT MOVED. KM-23 built the composer inside DexChat, as its own rounded
// bar. The founder's correction: the app already HAS a floating bar sitting
// exactly where a thumb is, and it should become the voice surface — the four
// destinations step aside, the wave takes the bar, and the FAB beside it turns
// into the microphone. Typing turns that same bar into a text field and the FAB
// into a send button. Nothing new is drawn.
//
// That splits one component across three: the bar hosts the input, the FAB
// submits it, and the transcript floats above. None of them can own the state,
// so it lives here and Layout hands it to all three.
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function useDexConversation({ dex, open } = {}) {
  const [log, setLog] = useState([]);
  const [ctxId, setCtxId] = useState(null);
  const [busy, setBusy] = useState(false);
  // "voice" -> the bar draws the wave, the FAB is a microphone.
  // "type"  -> the bar is a text field, the FAB is a send button.
  const [mode, setMode] = useState("voice");
  const [draft, setDraft] = useState("");
  const seenRef = useRef(null);

  const push = useCallback((m) => setLog((l) => [...l, { id: uid(), ...m }]), []);

  // Closing Dex returns the bar to voice, so re-opening never lands you in a
  // text field you did not ask for. The transcript is deliberately KEPT — the
  // founder can close, act on an answer and come back to it.
  useEffect(() => {
    if (!open) { setMode("voice"); setDraft(""); }
  }, [open]);

  // A finished capture becomes a turn in the transcript rather than its own
  // card. Keyed on noteId so a poll updating the same note in place cannot
  // stack duplicates.
  useEffect(() => {
    const u = dex?.understanding;
    if (!u || u.status !== "done") return;
    if (seenRef.current === u.noteId) return;
    seenRef.current = u.noteId;
    const title = u.decision?.title || u.summary || u.transcript;
    push({
      role: "dex",
      text: title
        ? `Got it — ${title}${u.tasks?.length ? `\n${u.tasks.length} task${u.tasks.length > 1 ? "s" : ""} created.` : ""}`
        : "Captured.",
    });
    dex.clearUnderstanding?.();
  }, [dex, dex?.understanding, push]);

  const ask = useCallback(async (question) => {
    const text = String(question || "").trim();
    if (!text || busy) return;
    push({ role: "user", text });
    setDraft("");
    setBusy(true);
    try {
      // Verified shape: { type, answer, missing_information, suggested_questions }.
      const { data } = await api.post("/ask", { question: text, context_id: ctxId });
      if (data.query_context_id) setCtxId(data.query_context_id);
      push({
        role: "dex",
        text: data.answer || "I don't have an answer for that yet.",
        followups: data.suggested_questions,
        missing: data.missing_information,
      });
    } catch (e) {
      push({ role: "dex", text: e.response?.data?.detail || "I couldn't reach the brain just now." });
    } finally {
      setBusy(false);
    }
  }, [busy, ctxId, push]);

  const attach = useCallback(async (file, label = "File") => {
    if (!file) return;
    push({ role: "user", text: `${label}: ${file.name}` });
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
      push({ role: "dex", text: "Filed. I'll pull what matters out of it." });
    } catch (err) {
      push({ role: "dex", text: err.response?.data?.detail || "That upload didn't go through." });
    } finally {
      setBusy(false);
    }
  }, [push]);

  /** What the FAB does right now — the single source for its icon and action.
      KM-51 — A DRAFT NOW OUTRANKS THE MODE. It used to read "send" only in type
      mode, so after a voice capture the button went straight back to a mic and
      there was nothing to press to send what you had just said. A draft is a
      draft however it got there: recording wins (stop), then any draft (send),
      then the mode decides. */
  const fabIntent =
    dex?.recording ? "stop"
    : draft.trim() ? "send"
    : mode === "type" ? "keyboard"
    : "mic";

  /* KM-51 — THREE PRESSES, THREE JOBS, and stop no longer sends.
     Before: stopping a recording uploaded it, the server structured it, and an
     answer arrived for something never confirmed. Founder: "I can't stop the
     recording... it takes it as a query and gives the answer, but I don't want
     it like that." So stop STOPS. The transcript comes back into the draft as a
     preview, the button becomes a send arrow, and the second press is what
     commits it — the same two-step typing already had. */
  const submit = useCallback(() => {
    if (dex?.recording) { dex.stopRecording?.(); return; }
    /* Transcription is still in flight. Without this the button falls through
       to "start recording" and you are taping over the thing you just said. */
    if (dex?.sending) return;
    if (draft.trim()) { ask(draft); return; }
    if (mode === "type") return;      // empty field: nothing to send
    dex?.startRecording?.();
  }, [ask, draft, dex, mode]);

  return { log, busy, mode, setMode, draft, setDraft, ask, attach, submit, fabIntent };
}

export default useDexConversation;
