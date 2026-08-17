import { useRef, useState } from "react";
import api from "../lib/api";
import { toast } from "sonner";
import { Microphone, Stop, Spinner } from "@phosphor-icons/react";

// Small mic button that records a short clip, transcribes it to text via
// /api/transcribe, and hands the text back through onText(). Reusable anywhere
// you want voice dictation into a text field.
export function MicDictateButton({ onText, language = "auto", title = "Dictate", className = "" }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (!blob.size) return;
        const fd = new FormData();
        fd.append("file", blob, "dictation.webm");
        fd.append("language", language);
        setBusy(true);
        try {
          const { data } = await api.post("/transcribe", fd, { headers: { "Content-Type": "multipart/form-data" } });
          const text = (data?.text || "").trim();
          if (text) { onText(text); toast.success("Transcribed"); }
          else toast("Didn't catch that — try again");
        } catch (e) {
          toast.error(e.response?.data?.detail || "Transcription failed");
        } finally { setBusy(false); }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch { toast.error("Microphone access denied"); }
  };
  const stop = () => { mediaRef.current?.stop(); setRecording(false); };

  return (
    <button
      type="button"
      data-testid="mic-dictate-button"
      onClick={recording ? stop : start}
      disabled={busy}
      title={recording ? "Stop & transcribe" : title}
      className={`flex items-center justify-center border border-border transition-all disabled:opacity-60 ${recording ? "bg-brand-600 text-white animate-pulse" : "bg-white hover:bg-accent"} ${className}`}
    >
      {busy ? <Spinner size={18} weight="bold" className="animate-spin" /> : recording ? <Stop size={18} weight="fill" /> : <Microphone size={18} weight="bold" />}
    </button>
  );
}
