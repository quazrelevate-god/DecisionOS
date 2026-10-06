import { roleLabel } from "../lib/departments";
import { useCallback, useEffect, useRef, useState } from "react";
import api from "../lib/api";
import { captureOutcome, failureReason, isReading, readyLine, OUTCOME_COPY } from "../lib/dexOutcome";
import { useDraft } from "./useDraft";

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
/* PILOT-1 A — `draftName` keeps what is typed in the composer (lib/drafts.js)
   across a reload, the phone closing the app, or leaving the screen and coming
   back. Only the Desk well passes one; sending empties the field, and an empty
   field is not a draft, so a sent message is never kept. */
export function useDexConversation({ dex, open, channel = "ask", onCommitted, userId, onEnding, draftName = null } = {}) {
  const [log, setLog] = useState([]);
  const [ctxId, setCtxId] = useState(null);
  const [busy, setBusy] = useState(false);
  // "voice" -> the bar draws the wave, the FAB is a microphone.
  // "type"  -> the bar is a text field, the FAB is a send button.
  const [mode, setMode] = useState("voice");
  /* J4-03 (JOURNEY-1) — the third value is the draft's own state: whether
     these words were read back from a previous visit, and how to throw them
     away. The well says so; a decision kept on a device and never mentioned is
     a decision the founder believes they made. */
  const [draft, setDraft, draftKept] = useDraft(draftName, "");
  // ASK-32 1.6 — files attached to the next decision, and the held recording
  // the draft came from (its words are reviewed here, then sent on as ONE note).
  const [pendingFiles, setPendingFiles] = useState([]);
  /* A COUNT, not a boolean: two files can be going up at once and a boolean
     would be cleared by whichever finished first. */
  const [attaching, setAttaching] = useState(0);
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
  }, [open, setDraft]);

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
  }, [channel, setDraft]);

  /* CLEAR THE CONVERSATION. The transcript was only ever emptied by switching
     doors (above), which meant Ask reopened with yesterday's answers still in
     it and the only way out was force-quitting the app — the founder's report.
     Everything a conversation IS goes: the turns, the thread the backend keeps
     it on (ctxId), the draft and anything staged but unsent. The capture itself
     is not touched; stopping one is the mic's business, not this button's. */
  const clear = useCallback(() => {
    setLog([]);
    setCtxId(null);
    setDraft("");
    setPendingFiles([]);
    heldNoteRef.current = null;
  }, [setDraft]);

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
      const names = [...new Set((p.tasks || []).map((t) => t.assignee_name || (t.assignee_role ? `${roleLabel(t.assignee_role)} team` : null)).filter(Boolean))];
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
  }, [setDraft]);

  /* ASK-33 Phase 4 — ONE NOTE AT A TIME. useDexCapture follows a single note: a
     new follow() retires the one in flight, and a recording's transcript poll
     shares the same generation. So nothing here starts another while a note
     is still being read or a recording is under way — that note would stop
     being polled and its ending would never be reported. */
  const oneAtATime = isReading(dex) || !!dex?.recording || !!dex?.sending;
  const canRetry = !busy && !oneAtATime;

  /* ASK-33 Phase 4 — a decide send also REPORTS what it did: { ok, noteId,
     text, files, file_ids } or { ok: false, message, text, files, file_ids }, so
     the Desk well can hand the capture to the phone's sheet. `follow: false`
     leaves the polling to the caller — whoever ends up showing the ending. */
  const ask = useCallback(async (question, { follow = true } = {}) => {
    const text = String(question || "").trim();
    const withFiles = pendingFiles.length > 0;
    if ((!text && !withFiles) || busy) return null;
    /* ASK-33.1 — ONE CAPTURE AT A TIME, enforced where the capture is made.
       A second send does reach the pipeline, so its decision still lands in the
       Decisions column — but it retires the first note's poll, and a FAILURE has
       nowhere else to land: plan item 5.2 coming back through a side door. So it
       is refused, said plainly, and released the moment the first note ends. */
    if (channel === "decide" && oneAtATime) {
      push({ role: "dex", text: OUTCOME_COPY.stillReading });
      return { ok: false, blocked: true, text, files: pendingFiles, file_ids: pendingFiles.map((f) => f.id) };
    }
    /* THE FILES GO INTO THE TURN, not just into the request. The chips used to
       vanish on send and the only evidence a file had been part of the question
       was Dex answering about it — the founder could see the backend had read
       something they could no longer see. The entries carry the local File, so
       the preview is drawn from memory and needs no round trip. */
    push({
      role: "user",
      text: text || pendingFiles.map((f) => f.name).join(", "),
      files: pendingFiles.map((f) => ({ id: f.id, name: f.name, type: f.type, file: f.file })),
    });
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
        /* ASK-34 A3 — `reading: true` MARKS this turn as the one the phone
           draws its thinking state in (DexChat). A flag, not a string match on
           the copy: the surface should not have to recognise a sentence to know
           what a message is. */
        push({ role: "dex", text: "Reading it now…", reading: true });
        if (data?.id) sentRef.current.set(data.id, { text, file_ids });
        if (follow && data?.id && dex?.follow) {
          seenRef.current = null;
          dex.follow(data.id, { transcript: text });
        }
        onCommitted?.();
        return { ...sent, ok: true, noteId: data?.id || null };
      }
      /* ASK-39 4 — the staged files leave with the question. /ask's contract is
         {question, context_id} and nothing else, so the files do not ride the
         request — they were uploaded into the Company Brain when they were
         attached, and `_retrieve` searches that store by the plan's keywords
         and by embedding. Naming them in the question is what points the
         retrieval at them; it is also what the founder just said out loud, so
         the transcript already reads that way. */
      /* THE UPLOAD HAPPENS HERE, once, on send. Each staged picture goes into
         the Company Brain now — which is also when it gets indexed, which is
         what makes naming it in the question find it. A file that will not
         upload is said out loud and left out of the question rather than
         silently named: Dex must not be told to look for something that is not
         there. */
      const staged = pendingFiles.filter((f) => f.staged && f.file);
      const landed = pendingFiles.filter((f) => !f.staged).map((f) => f.name);
      for (const f of staged) {
        try {
          const fd = new FormData();
          fd.append("file", f.file);
          fd.append("title", f.name);
          fd.append("kind", "other");
          fd.append("visibility", "private");
          const { data } = await api.post("/brain/documents", fd, { headers: { "Content-Type": "multipart/form-data" } });
          if (data?.id) landed.push(f.name);
          else push({ role: "dex", text: `${f.name} didn't go through, so I haven't read it.` });
        } catch (err) {
          const detail = err.response?.data?.detail;
          push({ role: "dex", text: typeof detail === "string" && detail
            ? detail
            : `${f.name} didn't go through, so I haven't read it.` });
        }
      }
      const named = landed.join(", ");
      const question = named ? `${text} (about the attached file${landed.length > 1 ? "s" : ""}: ${named})` : text;
      setPendingFiles([]);
      /* Verified against routers/brain.py, not guessed:
           ANSWER            { answer, sources, suggested_questions, kpis, table,
                               export_options, query_context_id, currency }
           INSUFFICIENT_DATA { answer, missing_information, suggested_questions }
           PERMISSION_DENIED { message, can_ask } — and NO `answer`. */
      const { data } = await api.post("/ask", { question, context_id: ctxId });
      if (data.query_context_id) setCtxId(data.query_context_id);
      /* A REFUSAL IS AN ANSWER, AND IT HAS ITS OWN FIELD. (2026-10-07, checking
         the mobile path against the Ask redesign that landed from the other
         branch.) That work's whole point was that "refusals name the access and
         what the person can ask" — and this chat read `data.answer`, which a
         refusal does not carry, so every one of them arrived on the phone as
         "I don't have an answer for that yet." The person was told nothing,
         twice over: not what was refused, and not what they could ask instead.
         `message` already ends with "You can ask me about tasks, decisions or
         workflows" (services/ai/brain_rbac.closed_message), so the words are
         complete — they only had to be shown. */
      if (data.type === "PERMISSION_DENIED") {
        push({
          role: "dex",
          restricted: true,
          text: data.message || "That is not something you can ask about here.",
        });
        return undefined;
      }
      push({
        role: "dex",
        text: data.answer || "I don't have an answer for that yet.",
        followups: data.suggested_questions,
        missing: data.missing_information,
        /* The Company Brain's typed, deep-linked citations. They were already
           in the payload and the phone was dropping them, so an answer drawn
           from a document arrived with nothing to say where it came from. */
        sources: data.sources,
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
  }, [busy, channel, ctxId, dex, onCommitted, oneAtATime, pendingFiles, push, setDraft]);

  /* ASK-39 4 — ASK STAGES A FILE, IT DOES NOT SEND ONE.
     Both channels used to post the moment a file was picked: a "File: x.webp"
     turn from you and, on Ask, "Saved to your files. Open Decide if you want
     Dex to act on it." That message was TRUE of where the bytes went — /files
     is a bare reference store that nothing reads — and it was the wrong place
     to send them. It also meant attaching was itself a send: no preview, no
     chance to say what you wanted asked about it.
     Ask now behaves exactly as Decide does. The file is uploaded (an id is
     needed either way) and STAGED as a pending chip; nothing is posted to the
     transcript; and you then speak or type the question that goes with it.
     WHERE THE BYTES GO IS THE OTHER HALF. On Ask they go to
     /api/brain/documents, not /files. That endpoint runs every upload through
     services/files._read_reference_text — which sends images and PDFs to
     services/vision.ai_read_image_general — then chunks and embeds the text
     into the same store /ask already searches (routers/brain.py `_retrieve`
     reads brain_documents). So "what does this invoice say" is a question the
     backend can already answer; the sheet was simply posting to the endpoint
     that files things away rather than the one that reads them. No backend
     change: this is two existing endpoints wired the right way round. */
  /* THE FILE IS IN THE ROW BEFORE IT IS ON THE SERVER (2026-10-02, founder).
     Uploading used to be invisible until it finished and then the chip simply
     appeared — and because `attach` raises `busy`, the transcript meanwhile
     said "Thinking…", which is a lie: Dex is not thinking about anything, a
     file is going up a wire. The founder's call is the ordinary one every app
     makes — show the thing you are waiting for, blank and pulsing.
     So a placeholder goes in immediately, carrying the File itself (which is
     local, so its preview is available long before the upload is), and is
     replaced in place when the id comes back. `uploading` is what the chip
     reads to draw the pulse; `attaching` is what the transcript reads to keep
     quiet. The placeholder is removed on failure, so a chip never outlives the
     upload it stood for. */
  const attach = useCallback(async (file, label = "File") => {
    if (!file) return;
    const tempId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    /* IN ASK, ATTACHING STAGES — IT DOES NOT UPLOAD. (2026-10-05.)
       Founder: "when I attach multiple images one by one, suddenly it started
       uploading and started analysing the image automatically without me
       clicking the send button."
       They were reading it exactly right. Ask's attach posted straight to
       /brain/documents, which files the image into the Company Brain as a
       permanent document AND spawns index_document() to embed it — so by the
       third picture the backend was three uploads and three embeddings deep
       into a question nobody had asked yet. (It is also owner/manager-only, so
       for anyone else the paperclip answered 403 for no reason they could see.)
       The upload moves to send(), where `ask` does it just before posting the
       question. Nothing reaches the Brain until the founder commits. The chip
       is drawn from the local File, so staging is instant and needs no
       skeleton — the picture is simply there the moment it is picked. */
    if (channel !== "decide") {
      setPendingFiles((p) => [...p, {
        id: tempId, name: file.name, type: file.type || "", file, staged: true,
      }]);
      return { ok: true, id: tempId, staged: true };
    }

    setPendingFiles((p) => [...p, {
      id: tempId, name: file.name, type: file.type || "", file, uploading: true,
    }]);
    setAttaching((n) => n + 1);
    setBusy(true);
    try {
      // Decide only, now: /files KEEPS a file and reads nothing. Ask's own
      // upload lives in `ask`, above, and happens on send.
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
      const id = data?.id || data?.file?.id;
      if (id) {
        /* ASK-33 — the entry also keeps the File and its type, so the Desk
           well can draw a preview chip. DexChat reads the name and the type.
           Replaced IN PLACE, so the chip the founder is already looking at
           becomes the real one rather than flickering away and back. */
        setPendingFiles((p) => p.map((f) => (f.id === tempId
          ? { id, name: file.name, type: file.type || "", file }
          : f)));
      } else {
        setPendingFiles((p) => p.filter((f) => f.id !== tempId));
      }
      // An upload that came back without an id attached nothing, whatever it
      // said; the caller must not treat it as done.
      return id ? { ok: true, id } : { ok: false, message: "That upload didn't go through." };
    } catch (err) {
      setPendingFiles((p) => p.filter((f) => f.id !== tempId));
      const detail = err.response?.data?.detail;
      const message = typeof detail === "string" && detail ? detail : "That upload didn't go through.";
      // A failure DOES belong in the transcript when there is one — it is the
      // only place the founder would see it — and it is handed back as well,
      // because the Desk well has no transcript to print it in.
      push({ role: "dex", text: message });
      return { ok: false, message };
    } finally {
      setAttaching((n) => Math.max(0, n - 1));
      setBusy(false);
    }
  }, [channel, push]);

  /** ASK-33 — take a file back off the next decision (the Desk well's chip).
      The upload itself stays in files, as a sent one always has. */
  const removeFile = useCallback((id) => setPendingFiles((p) => p.filter((f) => f.id !== id)), []);

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
      fresh.push({ id: uid(), role: "dex", text: "Reading it now…", reading: true });
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
  }, [dex, oneAtATime, setDraft]);

  /** What the FAB does right now — the single source for its icon and action.
      KM-51 — A DRAFT OUTRANKS THE MODE: recording wins (stop), then a draft
      (send), then the mode decides.

      ASK-53 — AN ATTACHMENT MUST NOT EAT THE MICROPHONE, which is ASK-36 1's
      rule arriving where it was always needed. The Desk well learned it then
      — "attach a file and the mic turns into a send arrow, so the only way
      left to say what to do with it is to type, on the very screen whose own
      words are 'Attached. Say or type what to do with it'" — but the dock's
      FAB kept counting a staged file as something to send, so attaching in
      the sheet took the microphone away too. A FILE IS NOT A MESSAGE; it is
      what a message is about. Only words in the field turn this button into
      send — typed, or spoken and transcribed back into it — and the file
      leaves with them as one note. So the order of business is: attach, then
      speak (the mic is still there), then stop, read back what Dex heard,
      then send. */
  const fabIntent =
    dex?.recording ? "stop"
    : draft.trim() ? "send"
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
    /* ASK-53 — the button does what its glyph says, and the glyph follows the
       FIELD, not the attachments (fabIntent). A staged file with nothing said
       about it therefore starts a recording rather than sending itself: the
       media is analysed WITH the message as its context, so a file on its own
       is half a thing to send. The file rides out with the words. */
    if (draft.trim()) { ask(draft); return; }
    if (mode === "type") return;      // empty field: nothing to send
    dex?.startRecording?.();
  }, [ask, draft, dex, mode]);

  return { log, busy, mode, setMode, draft, setDraft, draftKept, setDraftFromVoice, ask, attach, removeFile, retry, adopt, canRetry, submit, fabIntent, pendingFiles, attaching: attaching > 0, clear };
}

export default useDexConversation;
