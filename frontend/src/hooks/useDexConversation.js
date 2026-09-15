import { useCallback, useEffect, useRef, useState } from "react";
import api from "../lib/api";
import { captureOutcome, failureReason, isReading, readyLine, OUTCOME_COPY } from "../lib/dexOutcome";

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

/* KM-54 — `channel` is which door the founder came through, and it decides
   what a typed line MEANS. Nothing here guesses.
     "ask"    -> POST /ask            : read-only analytics, creates nothing
     "decide" -> POST /voice-notes/text: a decision waiting for approval, which
                                         lands in Decisions on the Desk. Its
                                         tasks and workflows are only created
                                         when it is approved (ASK-32 Phase 1). */
/* ASK-33 Phase 4 — two more options, for the phone's sheet.
     userId    who is reading, so "Decision ready for …" can say "you"
     onEnding  told of each Decide ending as it lands (Layout refreshes the Desk,
               and toasts the ending if the sheet has been closed) */
export function useDexConversation({ dex, open, channel = "ask", onCommitted, userId, onEnding } = {}) {
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
  // ASK-33 Phase 3 — what the last decide-channel send carried, for Retry.
  const lastSentRef = useRef(null);
  // ASK-33 Phase 4 — and what EACH note carried, by note id, so a failure's
  // Retry re-sends that capture rather than whichever was sent last.
  const sentRef = useRef(new Map());
  const seenRef = useRef(null);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const onEndingRef = useRef(onEnding);
  onEndingRef.current = onEnding;

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
     decide, or why it failed.
     ASK-33 Phase 4 — the turn also says WHICH ending it is (`outcome`, read by
     lib/dexOutcome), so the phone's sheet can put Review, Retry and the
     Settings link on it; and its words are lib/dexOutcome's, the Desk well's
     own, so the two surfaces print one sentence for one ending. (ASK-32 1.4's
     "a failed capture says why, in words a person can act on" lives there
     now.) A failure keeps the capture it came from, for its Retry. */
  useEffect(() => {
    const u = dex?.understanding;
    if (!u || !["done", "nothing", "failed", "slow"].includes(u.status)) return;
    const seenKey = `${u.noteId}:${u.status}`;
    if (seenRef.current === seenKey) return;
    seenRef.current = seenKey;
    const o = captureOutcome(u) || { kind: "slow" };
    let outcome = o;
    if (o.kind === "ready") {
      const d = u.decision || {};
      const p = d.proposal || {};
      const title = d.title || u.transcript || "";
      // The 5.1 line names who decides, so ASK-32 Phase 2's "Sent to … to
      // decide" is not repeated under it; the rest is the echo it always was.
      const lines = [title];
      const nTasks = (p.tasks || u.tasks || []).length;
      const names = [...new Set((p.tasks || []).map((t) => t.assignee_name || (t.assignee_role ? `${t.assignee_role} team` : null)).filter(Boolean))];
      if (nTasks && names.length) lines.push(`${nTasks} task${nTasks > 1 ? "s" : ""} for ${names.slice(0, 3).join(", ")}`);
      if ((p.workflows || []).length) {
        lines.push(p.workflows.map((w) => `${w.pipeline_label || "Workflow"}: ${w.title}`).slice(0, 2).join("\n"));
      }
      if (d.repeat_of) lines.push(`Looks like a repeat of “${d.repeat_of.title}”.`);
      if (d.status === "pending_approval") lines.push("Nothing is created until it's approved.");
      outcome = {
        kind: "ready",
        decisionId: o.decisionId,
        title,
        // A decision that could not be read still has the note's own counts.
        headline: readyLine(u.decision || { execution_summary: u.summary }, userIdRef.current),
        lines: lines.filter(Boolean),
      };
    } else if (o.kind === "failed") {
      outcome = { ...o, retry: sentRef.current.get(u.noteId) || null };
    }
    const text =
      outcome.kind === "ready" ? [outcome.headline, ...outcome.lines].join("\n")
      : outcome.kind === "nothing" ? [OUTCOME_COPY.nothing, outcome.answer].filter(Boolean).join("\n")
      : outcome.kind === "failed" ? outcome.message
      : OUTCOME_COPY.slow;
    const message = { id: uid(), role: "dex", text, outcome };
    dex.clearUnderstanding?.();
    /* ASK-33 Phase 5 — an ending the host reports somewhere else (Layout, when
       the sheet has been closed: a toast, or the failure notice) comes back
       true and is not also left in the transcript. Otherwise the next Ask
       sheet showed that failure twice — a message and the notice — with two
       Retries for one capture. */
    if (onEndingRef.current?.(message) === true) return;
    setLog((l) => [...l, message]);
  }, [dex, dex?.understanding]);

  /** ASK-32 1.6 — a finished recording fills the draft and remembers its note. */
  const setDraftFromVoice = useCallback((text, noteId) => {
    setDraft(text);
    heldNoteRef.current = noteId || null;
  }, []);

  /* ASK-33 Phase 4 — a decide send also REPORTS what it did: { ok, noteId,
     text, files, file_ids } or { ok: false, message, text, files, file_ids }, so
     the Desk well can hand the capture to the phone's sheet. `follow: false`
     leaves the polling to the caller — whoever ends up showing the ending. */
  const ask = useCallback(async (question, { follow = true } = {}) => {
    const text = String(question || "").trim();
    const withFiles = channel === "decide" && pendingFiles.length > 0;
    if ((!text && !withFiles) || busy) return null;
    push({ role: "user", text: text || pendingFiles.map((f) => f.name).join(", ") });
    setDraft("");
    setBusy(true);
    const files = channel === "decide" ? pendingFiles : [];
    const sent = { text, files, file_ids: files.map((f) => f.id) };
    try {
      if (channel === "decide") {
        const { file_ids } = sent;
        lastSentRef.current = { text, file_ids };
        const held = heldNoteRef.current;
        const { data } = held
          ? await api.post(`/voice-notes/${held}/submit`, { text, file_ids })
          : await api.post("/voice-notes/text", { text, file_ids });
        heldNoteRef.current = null;
        setPendingFiles([]);
        push({ role: "dex", text: "Reading it now…" });
        if (data?.id) sentRef.current.set(data.id, { text, file_ids });
        if (follow && data?.id && dex?.follow) {
          seenRef.current = null;
          dex.follow(data.id, { transcript: text });
        }
        onCommitted?.();
        return { ...sent, ok: true, noteId: data?.id || null };
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
      return undefined;
    } catch (e) {
      push({ role: "dex", text: e.response?.data?.detail || "I couldn't reach the brain just now." });
      if (channel !== "decide") return undefined;
      const detail = e.response?.data?.detail;
      return { ...sent, ok: false, message: typeof detail === "string" && detail ? detail : "I couldn't reach the brain just now." };
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

  /* ASK-33 Phase 4 — ONE NOTE AT A TIME. useDexCapture follows a single note: a
     new follow() retires the one in flight, and a recording's transcript poll
     shares the same generation. So nothing here starts another while a note
     is still being read or a recording is under way — that note would stop
     being polled and its ending would never be reported. */
  const oneAtATime = isReading(dex) || !!dex?.recording || !!dex?.sending;
  const canRetry = !busy && !oneAtATime;

  /** ASK-33 Phase 3 — Retry re-sends the same capture, its words and its files,
      rather than asking the founder to say it again. A held recording's words
      are text by the time it could fail, so it goes again as a typed note.
      Phase 4 — `payload` names the capture (a failed ending's own), and
      `fromId` is the message it came from, which then stops offering Retry.
      Phase 5 — `quiet`: re-sent from the failure notice while the sheet is
      closed, so nothing is written into a transcript no one is reading; if the
      re-send itself fails, that failure is reported the same way again. */
  const retry = useCallback(async (payload, fromId, { quiet = false } = {}) => {
    const last = payload || (channel === "decide" ? lastSentRef.current : null);
    if (!last || busy || oneAtATime) return false;
    setBusy(true);
    try {
      const { data } = await api.post("/voice-notes/text", { text: last.text, file_ids: last.file_ids });
      lastSentRef.current = last;
      if (fromId) {
        setLog((l) => l.map((m) => (m.id === fromId && m.outcome ? { ...m, outcome: { ...m.outcome, spent: true } } : m)));
      }
      if (!quiet) push({ role: "dex", text: "Reading it again…" });
      if (data?.id) sentRef.current.set(data.id, last);
      if (data?.id && dex?.follow) {
        seenRef.current = null;
        dex.follow(data.id, { transcript: last.text });
      }
      onCommitted?.();
      return true;
    } catch (e) {
      const detail = e.response?.data?.detail;
      const text = typeof detail === "string" && detail ? detail : "That didn't go through. Please try again.";
      const failure = { id: uid(), role: "dex", text, outcome: { kind: "failed", ...failureReason(text), retry: last } };
      if (!(quiet && onEndingRef.current?.(failure) === true)) push({ role: "dex", text });
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, channel, dex, oneAtATime, onCommitted, push]);

  /** ASK-33 Phase 4 — THE SHEET TAKES A CAPTURE THE DESK WELL SENT.
      { noteId, text, files } for a note that reached the pipeline, or
      { error, text, files } for a send that never did. The words go into the
      transcript and the note is followed HERE, so its ending lands in this
      transcript as any other. Returns false — and changes nothing — when there
      is nothing to take or when this hook is still reading another note (see
      ONE NOTE AT A TIME); the well then keeps the capture itself. */
  const adopt = useCallback(({ noteId = null, text = "", files = [], error = null } = {}) => {
    if (!noteId && !error) return false;
    if (noteId && !dex?.follow) return false;
    if (oneAtATime) return false;
    const payload = { text, file_ids: files.map((f) => f.id) };
    const said = text || files.map((f) => f.name).join(", ");
    const fresh = [];
    if (said) fresh.push({ id: uid(), role: "user", text: said });
    if (noteId) {
      fresh.push({ id: uid(), role: "dex", text: "Reading it now…" });
    } else {
      const f = failureReason(error);
      fresh.push({ id: uid(), role: "dex", text: f.message, outcome: { kind: "failed", ...f, retry: payload } });
    }
    /* KM-54 — arriving through the Decide door starts a Decide transcript. The
       switch is made here, before the channel changes, so the channel effect
       above does not then wipe what was just added. */
    const switching = lastChannelRef.current !== "decide";
    lastChannelRef.current = "decide";
    if (switching) {
      setCtxId(null);
      setDraft("");
      setPendingFiles([]);
      heldNoteRef.current = null;
    }
    setLog((l) => (switching ? fresh : [...l, ...fresh]));
    lastSentRef.current = payload;
    if (noteId) {
      sentRef.current.set(noteId, payload);
      seenRef.current = null;
      dex.follow(noteId, { transcript: text });
    }
    return true;
  }, [dex, oneAtATime]);

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

  return { log, busy, mode, setMode, draft, setDraft, setDraftFromVoice, ask, attach, removeFile, retry, adopt, canRetry, submit, fabIntent, pendingFiles };
}

export default useDexConversation;
