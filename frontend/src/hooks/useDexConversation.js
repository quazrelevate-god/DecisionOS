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

/* ASK-32 1.4 — a failed capture says why, in words a person can act on. */
function captureError(error) {
  const e = String(error || "");
  if (e.includes("ai_consent_required")) {
    return "AI is switched off for your company, so Dex couldn't read that. Turn on AI in Settings, then try again.";
  }
  return "That didn't go through. Please try again.";
}

/* KM-54 — `channel` is which door the founder came through, and it decides
   what a typed line MEANS. Nothing here guesses.
     "ask"    -> POST /ask            : read-only analytics, creates nothing
     "decide" -> POST /voice-notes/text: a decision waiting for approval, which
                                         lands in Decisions on the Desk. Its
                                         tasks and workflows are only created
                                         when it is approved (ASK-32 Phase 1). */
export function useDexConversation({ dex, open, channel = "ask", onCommitted } = {}) {
  const [log, setLog] = useState([]);
  const [ctxId, setCtxId] = useState(null);
  const [busy, setBusy] = useState(false);
  // "voice" -> the bar draws the wave, the FAB is a microphone.
  // "type"  -> the bar is a text field, the FAB is a send button.
  const [mode, setMode] = useState("voice");
  const [draft, setDraft] = useState("");
  // ASK-32 1.6 — files attached to the next decision, and the held recording
  // the draft came from (its words are reviewed here, then sent on as ONE note).
  const [pendingFiles, setPendingFiles] = useState([]);
  const heldNoteRef = useRef(null);
  const seenRef = useRef(null);

  const push = useCallback((m) => setLog((l) => [...l, { id: uid(), ...m }]), []);

  // Closing Dex returns the bar to voice, so re-opening never lands you in a
  // text field you did not ask for. The transcript is deliberately KEPT — the
  // founder can close, act on an answer and come back to it.
  useEffect(() => {
    if (!open) { setMode("voice"); setDraft(""); heldNoteRef.current = null; }
  }, [open]);

  /* KM-54 — SWITCHING DOORS STARTS A NEW TRANSCRIPT.
     Only a change BETWEEN doors clears it — the null the channel takes while
     Dex is closed is ignored, so reopening the same door still brings your
     answers back. */
  const lastChannelRef = useRef(channel);
  useEffect(() => {
    if (!channel) return;
    if (lastChannelRef.current && lastChannelRef.current !== channel) {
      setLog([]);
      setCtxId(null);
      setDraft("");
      setPendingFiles([]);
      heldNoteRef.current = null;
    }
    lastChannelRef.current = channel;
  }, [channel]);

  /* A finished capture becomes a turn in the transcript. Keyed on note + outcome
     so a poll updating the same note in place cannot stack duplicates.
     ASK-32 Phase 1: the reply says what Dex UNDERSTOOD and that it is waiting
     for a decision — nothing is created yet — or that there was nothing to
     decide, or why it failed. */
  useEffect(() => {
    const u = dex?.understanding;
    if (!u || !["done", "nothing", "failed", "slow"].includes(u.status)) return;
    const seenKey = `${u.noteId}:${u.status}`;
    if (seenRef.current === seenKey) return;
    seenRef.current = seenKey;
    let text;
    if (u.status === "nothing") {
      text = `Nothing to decide in that${u.said ? ` — ${u.said}` : ""}.\nIf it was a question, ask Dex instead.`;
    } else if (u.status === "failed") {
      text = captureError(u.error);
    } else if (u.status === "slow") {
      text = "Still working on it. It will show up in Decisions on the Desk.";
    } else {
      const d = u.decision || {};
      const p = d.proposal || {};
      const title = d.title || u.transcript || "your decision";
      const lines = [`Ready for a decision — ${title}`];
      // ASK-32 Phase 2 — say who decides when it is not the person who said it.
      if (d.approver_name && d.approver_id && d.approver_id !== d.created_by) lines.push(`Sent to ${d.approver_name} to decide.`);
      const nTasks = (p.tasks || u.tasks || []).length;
      if (nTasks) {
        const names = [...new Set((p.tasks || []).map((t) => t.assignee_name || (t.assignee_role ? `${t.assignee_role} team` : null)).filter(Boolean))];
        lines.push(`${nTasks} task${nTasks > 1 ? "s" : ""}${names.length ? ` for ${names.slice(0, 3).join(", ")}` : ""}`);
      }
      if ((p.workflows || []).length) {
        lines.push(p.workflows.map((w) => `${w.pipeline_label || "Workflow"}: ${w.title}`).slice(0, 2).join("\n"));
      }
      if (d.repeat_of) lines.push(`Looks like a repeat of “${d.repeat_of.title}”.`);
      lines.push(d.status === "pending_approval" ? "Nothing is created until it's approved." : "");
      text = lines.filter(Boolean).join("\n");
    }
    push({ role: "dex", text });
    dex.clearUnderstanding?.();
  }, [dex, dex?.understanding, push]);

  /** ASK-32 1.6 — a finished recording fills the draft and remembers its note. */
  const setDraftFromVoice = useCallback((text, noteId) => {
    setDraft(text);
    heldNoteRef.current = noteId || null;
  }, []);

  const ask = useCallback(async (question) => {
    const text = String(question || "").trim();
    const withFiles = channel === "decide" && pendingFiles.length > 0;
    if ((!text && !withFiles) || busy) return;
    push({ role: "user", text: text || pendingFiles.map((f) => f.name).join(", ") });
    setDraft("");
    setBusy(true);
    try {
      if (channel === "decide") {
        const file_ids = pendingFiles.map((f) => f.id);
        const held = heldNoteRef.current;
        const { data } = held
          ? await api.post(`/voice-notes/${held}/submit`, { text, file_ids })
          : await api.post("/voice-notes/text", { text, file_ids });
        heldNoteRef.current = null;
        setPendingFiles([]);
        push({ role: "dex", text: "Reading it now…" });
        if (data?.id && dex?.follow) dex.follow(data.id, { transcript: text });
        onCommitted?.();
        return;
      }
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
  }, [busy, channel, ctxId, dex, onCommitted, pendingFiles, push]);

  const attach = useCallback(async (file, label = "File") => {
    if (!file) return;
    push({ role: "user", text: `${label}: ${file.name}` });
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const id = data?.id || data?.file?.id;
      if (channel === "decide" && id) {
        /* ASK-33 — the entry also keeps the File and its type, so the Desk
           well can draw a preview chip. DexChat still reads only the name. */
        setPendingFiles((p) => [...p, { id, name: file.name, type: file.type || "", file }]);
        push({ role: "dex", text: "Attached. Say or type what to do with it — or press send and I'll read it." });
      } else {
        push({ role: "dex", text: "Saved to your files. Open Decide if you want Dex to act on it." });
      }
      // An upload that came back without an id attached nothing on the decide
      // channel, whatever it said above; the caller must not treat it as done.
      return channel === "decide" && !id ? { ok: false, message: "That upload didn't go through." } : { ok: true, id };
    } catch (err) {
      const detail = err.response?.data?.detail;
      const message = typeof detail === "string" && detail ? detail : "That upload didn't go through.";
      push({ role: "dex", text: message });
      // ASK-33 — the Desk well has no transcript to print this in, so the
      // reason is also handed back to the caller. DexChat ignores it.
      return { ok: false, message };
    } finally {
      setBusy(false);
    }
  }, [channel, push]);

  /** ASK-33 — take a file back off the next decision (the Desk well's chip).
      The upload itself stays in files, as a sent one always has. */
  const removeFile = useCallback((id) => setPendingFiles((p) => p.filter((f) => f.id !== id)), []);

  const canSendFiles = channel === "decide" && pendingFiles.length > 0;

  /** What the FAB does right now — the single source for its icon and action.
      KM-51 — A DRAFT NOW OUTRANKS THE MODE: recording wins (stop), then any
      draft or attached file (send), then the mode decides. */
  const fabIntent =
    dex?.recording ? "stop"
    : (draft.trim() || canSendFiles) ? "send"
    : mode === "type" ? "keyboard"
    : "mic";

  /* KM-51 — THREE PRESSES, THREE JOBS, and stop no longer sends. Stop STOPS;
     the transcript comes back into the draft as a preview, the button becomes a
     send arrow, and the second press is what commits it. */
  const submit = useCallback(() => {
    if (dex?.recording) { dex.stopRecording?.(); return; }
    /* Transcription is still in flight. Without this the button falls through
       to "start recording" and you are taping over the thing you just said. */
    if (dex?.sending) return;
    if (draft.trim() || canSendFiles) { ask(draft); return; }
    if (mode === "type") return;      // empty field: nothing to send
    dex?.startRecording?.();
  }, [ask, canSendFiles, draft, dex, mode]);

  return { log, busy, mode, setMode, draft, setDraft, setDraftFromVoice, ask, attach, removeFile, submit, fabIntent, pendingFiles };
}

export default useDexConversation;
