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

import { useState, useRef } from "react";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { toast } from "sonner";
import {
  Microphone, Stop, PaperPlaneTilt, Paperclip, Spinner,
} from "@phosphor-icons/react";


export function DexCaptureBar({ onCaptured, placeholder = "Ask Dex or capture a decision…" }) {
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
    <div className="border border-black bg-white p-3 mb-6" data-testid="dex-capture-bar">
      <div className="flex items-stretch gap-2">
        {!recording && (
          <button
            data-testid="dex-mic-record"
            onClick={startRecording}
            disabled={sending}
            title="Record a voice note for Dex"
            className="w-11 h-11 flex items-center justify-center border border-black hover:bg-brand-red hover:text-white transition-colors disabled:opacity-50"
          >
            <Microphone size={18} weight="bold" />
          </button>
        )}
        {recording && (
          <button
            data-testid="dex-mic-stop"
            onClick={stopRecording}
            className="w-11 px-3 flex items-center justify-center gap-2 bg-brand-red text-white font-mono text-xs border border-black animate-pulse"
          >
            <Stop size={16} weight="fill" />
            <span>{recordSecs}s</span>
          </button>
        )}
        <input
          data-testid="dex-text-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendText()}
          disabled={recording || sending}
          placeholder={placeholder}
          className="flex-1 border border-black px-3 py-2 text-sm font-mono focus:outline-none disabled:opacity-50"
        />
        <input
          type="file"
          ref={fileRef}
          hidden
          onChange={uploadFile}
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
        />
        <button
          data-testid="dex-file-upload"
          onClick={() => fileRef.current?.click()}
          disabled={sending || recording}
          title="Attach a file"
          className="w-11 h-11 flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors disabled:opacity-50"
        >
          <Paperclip size={16} weight="bold" />
        </button>
        <button
          data-testid="dex-send"
          onClick={sendText}
          disabled={!text.trim() || sending || recording}
          className="px-4 flex items-center gap-2 bg-brand-ink text-white text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm disabled:opacity-50 transition-all"
        >
          {sending ? <Spinner size={16} className="animate-spin" /> : <PaperPlaneTilt size={16} weight="bold" />}
          Send
        </button>
      </div>
    </div>
  );
}
