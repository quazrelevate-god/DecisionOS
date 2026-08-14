// Epic 2 Sprint 5 (E2-33) — Dex Capture Bar.
//
// Extracted from pages/Desk.js CaptureBar and rebadged for the new
// Dex home. Founder ask 2026-08-14: 'remove the ai from the desk
// button and integrate with brain, make it single AI name.'
//
// Same behaviour as the Desk CaptureBar it replaces:
//   - mic recorder (mediaRecorder API, pause/resume/finalise)
//   - text directive input (Enter to send)
//   - file attach (image/PDF/doc)
// Uploads to the same /voice-notes + /voice-notes/text endpoints —
// zero backend change.
//
// Naming: 'DexCaptureBar' component + testid prefix 'dex-capture-*'
// so instrumentation is unambiguous and future auth-persona checks
// can key on it.

import { useState, useRef, useEffect } from "react";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { toast } from "sonner";
import {
  Microphone, Stop, PaperPlaneTilt, Paperclip, Spinner,
} from "@phosphor-icons/react";


// MPWA-03 additions (additive only — endpoints, recorder and upload paths are
// untouched, per §7 "reuse it, do not rebuild"):
//   onRecordingChange(recording, secs)  lets DexFab mirror the recording state
//                                       (§8: FAB turns danger, shows elapsed
//                                       seconds) without a second timer that
//                                       would drift against this one.
//   seedText                            lets DexSheet's suggestion chips fill
//                                       the input instead of duplicating the
//                                       send logic.
//   size="lg"                           thumb-sized mic/input for the sheet.
export function DexCaptureBar({
  onCaptured,
  placeholder = "Ask Dex or capture a decision…",
  onRecordingChange,
  seedText,
  size = "default",
}) {
  const { user } = useAuth();
  const canCapture = user?.role === "owner" || hasPerm(user, "voice_capture");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileRef = useRef(null);
  const lg = size === "lg";

  useEffect(() => {
    onRecordingChange?.(recording, recordSecs);
    // onRecordingChange is a stable callback from the caller; re-running on
    // every identity change would fire on each parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, recordSecs]);

  useEffect(() => {
    if (seedText) setText(seedText);
  }, [seedText]);

  // Never leave the mic hot or the interval running if the sheet unmounts
  // mid-recording — §5.6: a long job must be cancellable, not orphaned.
  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      if (mediaRef.current?.state === "recording") mediaRef.current.stop();
    },
    []
  );

  if (!canCapture) return null;

  const sendText = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post("/voice-notes/text", { text: text.trim() });
      toast.success("Captured — Dex is structuring it now");
      setText("");
      onCaptured && onCaptured();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Capture failed");
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "capture.webm");
        fd.append("language", "auto");
        setSending(true);
        try {
          await api.post("/voice-notes", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          toast.success("Voice captured — Dex is structuring it");
          onCaptured && onCaptured();
        } catch (e) {
          toast.error(e.response?.data?.detail || "Upload failed");
        } finally {
          setSending(false);
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      setRecordSecs(0);
      timerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch (e) {
      toast.error("Microphone not available");
    }
  };

  const stopRecording = () => {
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
    setRecording(false);
    clearInterval(timerRef.current);
  };

  const uploadFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    setSending(true);
    try {
      await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("File uploaded to Dex");
      onCaptured && onCaptured();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed");
    } finally {
      setSending(false);
      e.target.value = "";
    }
  };

  return (
    <div
      className={lg ? "" : "border border-black bg-white p-3 mb-6"}
      data-testid="dex-capture-bar"
    >
      {/* At `lg` the row becomes a 2x2 grid: [mic][input] over [attach][Send].
          One row cannot hold mic + input + attach + Send at 390px without
          clipping Send at the right edge — the exact defect §8 MPWA-11 calls
          out ("today only part of the label is visible"). The default variant
          keeps the original single flex row via `display: contents`. */}
      <div className={lg ? "grid grid-cols-[3.5rem_1fr] gap-2" : "flex items-stretch gap-2"}>
        {!recording && (
          <button
            data-testid="dex-mic-record"
            onClick={startRecording}
            disabled={sending}
            title="Record a voice note for Dex"
            aria-label="Record a voice note for Dex"
            className={`flex items-center justify-center border border-black hover:bg-brand-red hover:text-white transition-colors disabled:opacity-50 ${lg ? "w-14 h-14 rounded-xl" : "w-11 h-11"}`}
          >
            <Microphone size={lg ? 26 : 18} weight="bold" />
          </button>
        )}
        {recording && (
          <button
            data-testid="dex-mic-stop"
            onClick={stopRecording}
            aria-label={`Stop recording (${recordSecs} seconds)`}
            className={`px-3 flex items-center justify-center gap-2 bg-brand-red text-white font-mono border border-black animate-pulse ${lg ? "h-14 rounded-xl text-sm" : "w-11 text-xs"}`}
          >
            <Stop size={lg ? 22 : 16} weight="fill" />
            <span className="tabular-nums">{recordSecs}s</span>
          </button>
        )}
        <input
          data-testid="dex-text-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendText()}
          disabled={recording || sending}
          placeholder={placeholder}
          className={`flex-1 min-w-0 border border-black px-3 py-2 focus:outline-none disabled:opacity-50 ${lg ? "h-12 text-base rounded-xl" : "text-sm font-mono"}`}
        />
        <input
          type="file"
          ref={fileRef}
          hidden
          onChange={uploadFile}
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
        />
        <div className={lg ? "col-span-2 flex items-stretch gap-2" : "contents"}>
          <button
            data-testid="dex-file-upload"
            onClick={() => fileRef.current?.click()}
            disabled={sending || recording}
            title="Attach a file"
            aria-label="Attach a file"
            className={`flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors disabled:opacity-50 ${lg ? "w-12 h-12 rounded-xl shrink-0" : "w-11 h-11"}`}
          >
            <Paperclip size={lg ? 22 : 16} weight="bold" />
          </button>
          <button
            data-testid="dex-send"
            onClick={sendText}
            disabled={!text.trim() || sending || recording}
            className={`flex items-center justify-center gap-2 bg-brand-ink text-white font-semibold border border-black hover:shadow-brutal-sm disabled:opacity-50 transition-all ${
              lg ? "flex-1 h-12 rounded-xl text-base" : "px-4 text-sm uppercase tracking-wider"
            }`}
          >
            {sending ? <Spinner size={lg ? 20 : 16} className="animate-spin" /> : <PaperPlaneTilt size={lg ? 20 : 16} weight="bold" />}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
