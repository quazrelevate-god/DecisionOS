// MPWA-12e · useDexCapture — the capture machine, with no opinion about pixels.
//
// §5.6 asks for a Dex sheet that is a centred mic with a live waveform and an
// "understanding" state, not "a title, an input and four full-width text
// buttons". That is a different *presentation* of the same behaviour, and
// MPWA-03's rule still holds: "reuse it, do not rebuild". Rebuilding the
// recorder would give us two copies of the mic lifecycle and two places for the
// upload endpoints to drift.
//
// So the behaviour lives here and both surfaces consume it:
//   DexCaptureBar (desktop /brain, unchanged markup)  ·  DexSheet (mobile)
//
// Endpoints are exactly the ones Sprint 5 shipped — POST /voice-notes,
// POST /voice-notes/text, POST /files. Nothing new, nothing renamed.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api from "../lib/api";

export const BARS = 28;

// Every ~55ms rather than every frame: a waveform reads as live at 18fps, and
// 60fps of React state for 28 numbers is a rendering budget spent on nothing.
const AMP_INTERVAL_MS = 55;

// The backend structures a capture in a BackgroundTask and moves the note
// through queued -> transcribing -> structuring -> done. §5.6: the founder must
// SEE that, not sit behind a "structuring…" banner, so we poll it.
const POLL_MS = 1200;
const POLL_TIMEOUT_MS = 90000;

/**
 * @param {{onCaptured?:Function, onRecordingChange?:Function, watch?:boolean,
 *          onTranscript?:Function}} opts
 *        watch — poll the note until it is structured and expose `understanding`.
 *        Off by default so DexCaptureBar's behaviour is bit-for-bit unchanged.
 *
 *        onTranscript — KM-51. When given, stopping a recording TRANSCRIBES AND
 *        STOPS THERE: the text is handed back and nothing is structured, nothing
 *        is auto-sent. It exists because the phone's Dex had no review step —
 *        `mr.onstop` uploaded, `follow()` structured, and an answer appeared for
 *        something the founder had not confirmed saying. Their words: "only when
 *        I press the stop button it should take that as a query", and then a
 *        preview before it goes anywhere. A hook that both records AND commits
 *        cannot offer that, so the commit half is now the caller's decision.
 */
export function useDexCapture({ onCaptured, onRecordingChange, watch = false, onTranscript, channel = "capture" } = {}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  // 0..1 per bar, oldest first — a scrolling window of loudness.
  const [levels, setLevels] = useState(() => new Array(BARS).fill(0));
  // { noteId, status, transcript, language, decision, tasks[] } | null
  const [understanding, setUnderstanding] = useState(null);
  // Held in a ref so changing the handler never re-creates startRecording and
  // orphans a live MediaRecorder.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  /* KM-54 — "channel" decides what a finished recording MEANS, and it is read
     at onstop rather than captured when the recorder was built, so switching
     Ask/Decide mid-take does the right thing.
       "capture"  -> POST /voice-notes   : structured into a decision + tasks
       "dictate"  -> POST /transcribe    : text back, nothing persisted */
  const channelRef = useRef(channel);
  channelRef.current = channel;
  /* KM-54 — the two refs that fix the "I have to press stop three times" bug.
     `starting` is true across the getUserMedia await, so a second tap cannot
     open a second microphone; `cancelStart` lets a stop pressed DURING that
     await be honoured when the stream finally arrives. */
  const startingRef = useRef(false);
  const cancelStartRef = useRef(false);

  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileRef = useRef(null);
  const audioRef = useRef(null); // { ctx, analyser, data, raf, interval }
  const pollRef = useRef(null);
  const aliveRef = useRef(true);
  /* KM-23 · the DISMISS token, and why aliveRef was not enough.
     aliveRef answers "is the component still mounted". It does not answer "does
     the user still want this card", and those came apart in the one place it
     mattered: `step` awaits a GET before it writes state, so dismissing the
     card while a request was in flight cleared `understanding`, the request
     then resolved, and the resumed continuation called setUnderstanding and
     brought the card straight back. That is the ghost card — a black sheet
     re-opening seconds after you closed it, with no way to make it stop except
     closing it again after every poll.
     Every write inside a follow() is now gated on the generation that started
     it. clearUnderstanding bumps the counter, so an in-flight poll from the
     dismissed run finds itself stale and drops its result on the floor. */
  const followRef = useRef(0);

  useEffect(() => {
    onRecordingChange?.(recording, recordSecs);
    // The callback identity changes on every parent render; depending on it
    // would fire this effect constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, recordSecs]);

  const stopMeter = useCallback(() => {
    const a = audioRef.current;
    audioRef.current = null;
    if (!a) return;
    clearInterval(a.interval);
    try { a.source?.disconnect(); } catch { /* already gone */ }
    try { a.ctx?.close(); } catch { /* already closed */ }
  }, []);

  // Never leave the mic hot, the timer running or a poll in flight if the host
  // unmounts mid-capture (§5.6: a long job is cancellable, never orphaned).
  //
  // `alive` is (re)armed in the effect body, not merely at ref creation: React
  // StrictMode runs mount -> cleanup -> mount on the same instance, and refs
  // survive that, so a flag only ever set to false in cleanup stayed false for
  // the rest of the component's life. The symptom was the understanding state
  // frozen on "queued" forever — the poll ran once and every branch of it bailed
  // on a flag that could no longer be true.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      clearInterval(timerRef.current);
      clearTimeout(pollRef.current);
      stopMeter();
      if (mediaRef.current?.state === "recording") mediaRef.current.stop();
    };
  }, [stopMeter]);

  /** KM-51 — poll one note only until its TRANSCRIPT exists, then hand it back.
      Deliberately not `follow()`: that one waits for `status === "done"` and a
      decision_id, i.e. for the server to have committed the thing. Here the
      transcript is the whole point and the commit has not been authorised yet. */
  const pollTranscript = useCallback(async (noteId) => {
    const startedAt = Date.now();
    const gen = ++followRef.current;
    const live = () => aliveRef.current && followRef.current === gen;
    const step = async () => {
      if (!live()) return;
      try {
        const note = (await api.get(`/voice-notes/${noteId}`)).data || {};
        if (note.transcript) { setSending(false); onTranscriptRef.current?.(note.transcript); return; }
        if (note.status === "failed" || note.error) {
          setSending(false);
          toast.error(note.error || "Could not transcribe that");
          return;
        }
      } catch { /* a dropped poll is not a failure — the next one may land */ }
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setSending(false);
        toast.error("Transcription timed out");
        return;
      }
      pollRef.current = setTimeout(step, POLL_MS);
    };
    step();
  }, []);

  /** Poll one note until it is structured, then read the decision it produced. */
  const follow = useCallback(async (noteId, seed = {}) => {
    const startedAt = Date.now();
    const gen = ++followRef.current;
    // Mounted AND still the run the user is looking at.
    const live = () => aliveRef.current && followRef.current === gen;
    setUnderstanding({ noteId, status: "queued", ...seed });

    const step = async () => {
      if (!live()) return;
      try {
        const note = (await api.get(`/voice-notes/${noteId}`)).data || {};
        const base = {
          noteId,
          status: note.status || "queued",
          transcript: note.transcript || seed.transcript || "",
          language: note.detected_language_name || null,
          summary: note.execution_summary || null,
          error: note.error || null,
        };

        if (note.status === "done" && note.decision_id) {
          // The decision carries the structure: title, summary, and the tasks it
          // produced. That IS the echo §5.6 wants — extracted fields, not a
          // paraphrase we invent on the client.
          let decision = null;
          let tasks = [];
          try {
            decision = (await api.get(`/decisions/${note.decision_id}`)).data || null;
          } catch { /* the note is done even if the decision read fails */ }
          const ids = (decision?.task_ids || []).slice(0, 4);
          if (ids.length) {
            const got = await Promise.all(
              ids.map((id) => api.get(`/tasks/${id}`).then((r) => r.data).catch(() => null))
            );
            tasks = got.filter(Boolean);
          }
          if (!live()) return;
          setUnderstanding({ ...base, decisionId: note.decision_id, decision, tasks });
          return;
        }
        if (note.status === "failed") {
          if (live()) setUnderstanding({ ...base, status: "failed" });
          return;
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          // Still working. Say so plainly instead of spinning forever — it did
          // land, and the Desk is where it shows up.
          if (live()) setUnderstanding({ ...base, status: "slow" });
          return;
        }
        if (live()) {
          setUnderstanding(base);
          pollRef.current = setTimeout(step, POLL_MS);
        }
      } catch {
        if (live()) setUnderstanding((u) => (u ? { ...u, status: "failed" } : u));
      }
    };
    pollRef.current = setTimeout(step, 400);
  }, []);

  const sendText = useCallback(async () => {
    const body = text.trim();
    if (!body) return null;
    setSending(true);
    try {
      const res = await api.post("/voice-notes/text", { text: body });
      if (watch && res.data?.id) follow(res.data.id, { transcript: body });
      else toast.success("Captured — Dex is structuring it now");
      setText("");
      onCaptured?.();
      return res.data;
    } catch (e) {
      toast.error(e.response?.data?.detail || "Capture failed");
      return null;
    } finally {
      setSending(false);
    }
  }, [text, watch, follow, onCaptured]);

  /* KM-54 — THE "I CAN'T STOP IT" BUG.
     Founder: "if I press the mic icon I can't be able to stop; only after
     pressing two or three times it's stopping, and everything has so much
     delay."

     This function is async and `setRecording(true)` used to be its LAST
     statement — after `await getUserMedia`, after building the MediaRecorder,
     after opening an AudioContext and wiring an AnalyserNode. On a phone that
     await is hundreds of milliseconds and, the first time or after the app has
     been backgrounded, seconds. For that entire window the hook reported
     `recording: false`, so the FAB still showed a microphone. A second tap
     therefore did not read as "stop" — it fell through the intent chain to
     `startRecording()` again and opened a SECOND stream, whose MediaRecorder
     overwrote `mediaRef.current`. The first one was then unreachable: its
     stream stayed live (mic hot), its AudioContext was never closed, and
     stopping only ever stopped the newest of them. Hence three presses, and
     hence the whole thing getting slower the longer the session ran — iOS caps
     concurrent AudioContexts, so after a few double-starts the meter silently
     stopped being created at all.

     Two refs fix it. `startingRef` makes a start non-re-entrant, so the second
     tap is a no-op instead of a second microphone. `recording` now flips
     OPTIMISTICALLY, before the await, so the button becomes a stop the instant
     it is pressed — and `cancelStartRef` means a stop pressed while the stream
     is still being granted is remembered and applied the moment it arrives,
     instead of being lost. */
  const startRecording = useCallback(async () => {
    if (startingRef.current || mediaRef.current?.state === "recording") return false;
    startingRef.current = true;
    cancelStartRef.current = false;
    // Optimistic: the UI must answer the tap, not the hardware.
    setRecording(true);
    setRecordSecs(0);
    setLevels(new Array(BARS).fill(0));
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);

    const abandon = () => {
      startingRef.current = false;
      setRecording(false);
      clearInterval(timerRef.current);
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop was pressed while the browser was still granting the mic.
      if (cancelStartRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        abandon();
        return false;
      }
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopMeter();
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "capture.webm");
        fd.append("language", "auto");
        setSending(true);
        try {
          /* KM-54 — DICTATION IS NOT CAPTURE.
             In Ask mode the audio must not become a decision, and it must not
             wait on one either: POST /transcribe writes a temp file, returns
             the text in the same response and persists nothing. That also
             removes the whole poll loop from the Ask path — no background
             task to be scheduled, no 1.2s poll interval to sit through — which
             is most of the "transcribing takes so much time" the founder felt.
             Capture keeps /voice-notes, because there the structuring IS the
             point. */
          if (channelRef.current === "dictate") {
            const { data } = await api.post("/transcribe", fd, {
              headers: { "Content-Type": "multipart/form-data" },
            });
            setSending(false);
            const said = (data?.text || "").trim();
            if (said) onTranscriptRef.current?.(said);
            else toast.error("I didn't catch that — try again");
            return;
          }
          const res = await api.post("/voice-notes", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          /* KM-51 — with onTranscript the upload is a TRANSCRIPTION request and
             nothing more. `sending` deliberately stays true through the poll,
             because from the founder's side one wait is still running. */
          if (onTranscriptRef.current && res.data?.id) {
            pollTranscript(res.data.id);
            onCaptured?.();
            return;
          }
          if (watch && res.data?.id) follow(res.data.id);
          else toast.success("Voice captured — Dex is structuring it");
          onCaptured?.();
          setSending(false);
        } catch (e) {
          toast.error(e.response?.data?.detail || "Upload failed");
          setSending(false);
        }
      };

      // §5.6: "A timer says a process is running; a waveform says I am
      // listening to you." An AnalyserNode on the live stream is the only way to
      // make the bars mean anything — a random-number animation would be a lie
      // told at 18fps.
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.6;
          source.connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const interval = setInterval(() => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            // RMS, then a gentle curve so ordinary speech uses the top half of
            // the bar rather than hugging the floor.
            const rms = Math.sqrt(sum / data.length);
            const level = Math.min(1, Math.pow(rms * 3.2, 0.65));
            setLevels((prev) => [...prev.slice(1), level]);
          }, AMP_INTERVAL_MS);
          audioRef.current = { ctx, source, analyser, data, interval };
        }
      } catch {
        // No AudioContext (or the browser refused it): the sheet falls back to
        // the elapsed seconds, which is still honest.
      }

      mediaRef.current = mr;
      mr.start();
      startingRef.current = false;
      /* One last look: a stop can also land between the stream arriving and
         the recorder starting. Honour it rather than leaving a take running
         that nothing is going to end. */
      if (cancelStartRef.current) { try { mr.stop(); } catch { /* already gone */ } }
      // recording / secs / levels were set before the await — see the note above.
      return true;
    } catch {
      abandon();
      stopMeter();
      toast.error("Microphone not available");
      return false;
    }
  }, [watch, follow, onCaptured, stopMeter, pollTranscript]);

  const stopRecording = useCallback(() => {
    /* KM-54 — a stop pressed during the getUserMedia await is REMEMBERED,
       not dropped. Without this the tap did nothing at all and the recording
       started a moment later anyway, which is what made it feel unstoppable. */
    if (startingRef.current) cancelStartRef.current = true;
    const mr = mediaRef.current;
    // `!== "inactive"` rather than `=== "recording"`: a paused recorder still
    // has to be stopped, and a stop on an inactive one is what used to throw.
    if (mr && mr.state !== "inactive") { try { mr.stop(); } catch { /* already stopped */ } }
    setRecording(false);
    clearInterval(timerRef.current);
    stopMeter();
  }, [stopMeter]);

  const uploadFile = useCallback(async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    setSending(true);
    try {
      await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("File uploaded to Dex");
      onCaptured?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed");
    } finally {
      setSending(false);
      e.target.value = "";
    }
  }, [onCaptured]);

  /** Drop the understanding card and stop following the note. */
  const clearUnderstanding = useCallback(() => {
    clearTimeout(pollRef.current);
    // Retire the generation as well as the timer: a poll already awaiting a
    // response cannot be cancelled, only ignored when it comes back.
    followRef.current += 1;
    setUnderstanding(null);
  }, []);

  const reset = useCallback(() => {
    clearUnderstanding();
    setText("");
    setLevels(new Array(BARS).fill(0));
    setRecordSecs(0);
  }, [clearUnderstanding]);

  return {
    text, setText,
    sending, recording, recordSecs, levels,
    understanding, clearUnderstanding, reset,
    sendText, startRecording, stopRecording, uploadFile,
    fileRef,
  };
}

export default useDexCapture;
