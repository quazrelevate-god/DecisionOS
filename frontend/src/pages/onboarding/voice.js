import { useRef, useState } from "react";
import api from "../../lib/api";
import { toast } from "sonner";

// Fetch spoken audio for a line of assistant text (Sarvam bulbul:v3 via backend).
export async function fetchTTS(text) {
  const { data } = await api.post("/signup/tts", { text });
  return new Audio(`data:${data.mime || "audio/wav"};base64,${data.audio_b64}`);
}

// Mic recorder for interview answers → transcribes via public /signup/stt (Sarvam saaras:v3).
export function useAnswerRecorder(onText) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
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
        fd.append("file", blob, "answer.webm");
        setTranscribing(true);
        try {
          const { data } = await api.post("/signup/stt", fd, { headers: { "Content-Type": "multipart/form-data" } });
          const text = (data?.text || "").trim();
          if (text) onText(text);
          else toast("Didn't catch that — try again or type your answer");
        } catch (e) {
          toast.error(e.response?.data?.detail || "Couldn't transcribe — type your answer instead");
        } finally {
          setTranscribing(false);
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      toast.error("Microphone access denied — you can type your answer");
    }
  };
  const stop = () => {
    mediaRef.current?.stop();
    setRecording(false);
  };
  return { recording, transcribing, start, stop };
}
