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
 * @param {{onCaptured?:Function, onRecordingChange?:Function, watch?:boolean}} opts
 *        watch — poll the note until it is structured and expose `understanding`.
 *        Off by default so DexCaptureBar's behaviour is bit-for-bit unchanged.
 */
export function useDexCapture({ onCaptured, onRecordingChange, watch = false } = {}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  // 0..1 per bar, oldest first — a scrolling window of loudness.
  const [levels, setLevels] = useState(() => new Array(BARS).fill(0));
  // { noteId, status, transcript, language, decision, tasks[] } | null
  const [understanding, setUnderstanding] = useState(null);

  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileRef = useRef(null);
  const audioRef = useRef(null); // { ctx, analyser, data, raf, interval }
  const pollRef = useRef(null);
  const aliveRef = useRef(true);
  // MPWA-15: the live capture stream, exposed so the Dex orb can hang its own
  // AnalyserNode on it. Sharing the stream rather than calling getUserMedia a
  // second time — two concurrent captures of one mic is a real source of
  // trouble on iOS, and the permission is already granted by the time this is
  // set. Null whenever nothing is recording.
  const streamRef = useRef(null);

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

  /** Poll one note until it is structured, then read the decision it produced. */
  const follow = useCallback(async (noteId, seed = {}) => {
    const startedAt = Date.now();
    setUnderstanding({ noteId, status: "queued", ...seed });

    const step = async () => {
      if (!aliveRef.current) return;
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
          if (!aliveRef.current) return;
          setUnderstanding({ ...base, decisionId: note.decision_id, decision, tasks });
          return;
        }
        if (note.status === "failed") {
          if (aliveRef.current) setUnderstanding({ ...base, status: "failed" });
          return;
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          // Still working. Say so plainly instead of spinning forever — it did
          // land, and the Desk is where it shows up.
          if (aliveRef.current) setUnderstanding({ ...base, status: "slow" });
          return;
        }
        if (aliveRef.current) {
          setUnderstanding(base);
          pollRef.current = setTimeout(step, POLL_MS);
        }
      } catch {
        if (aliveRef.current) setUnderstanding((u) => (u ? { ...u, status: "failed" } : u));
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

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        streamRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        stopMeter();
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "capture.webm");
        fd.append("language", "auto");
        setSending(true);
        try {
          const res = await api.post("/voice-notes", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          if (watch && res.data?.id) follow(res.data.id);
          else toast.success("Voice captured — Dex is structuring it");
          onCaptured?.();
        } catch (e) {
          toast.error(e.response?.data?.detail || "Upload failed");
        } finally {
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
      setLevels(new Array(BARS).fill(0));
      setRecording(true);
      setRecordSecs(0);
      timerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
      return true;
    } catch {
      toast.error("Microphone not available");
      return false;
    }
  }, [watch, follow, onCaptured, stopMeter]);

  const stopRecording = useCallback(() => {
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
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
    fileRef, streamRef,
  };
}

export default useDexCapture;
