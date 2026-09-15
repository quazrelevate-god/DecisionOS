import { useEffect, useRef, useState } from "react";
import api from "../../lib/api";
import { toast } from "sonner";

// Sarvam bulbul:v3 voices for the assistant. Kept in sync with backend SUPPORTED_TTS_LANGS.
export const SPOKEN_LANGS = [
  { code: "en-IN", label: "English", short: "EN" },
  { code: "hi-IN", label: "Hindi", short: "हिं" },
  { code: "bn-IN", label: "Bengali", short: "বাং" },
  { code: "gu-IN", label: "Gujarati", short: "ગુજ" },
  { code: "kn-IN", label: "Kannada", short: "ಕನ್" },
  { code: "ml-IN", label: "Malayalam", short: "മല" },
  { code: "mr-IN", label: "Marathi", short: "मरा" },
  { code: "od-IN", label: "Odia", short: "ଓଡ଼" },
  { code: "pa-IN", label: "Punjabi", short: "ਪੰਜਾ" },
  { code: "ta-IN", label: "Tamil", short: "தமி" },
  { code: "te-IN", label: "Telugu", short: "తెలు" },
];

export const langLabel = (code) =>
  SPOKEN_LANGS.find((l) => l.code === code)?.label || "English";

// Fetch spoken audio for a line of assistant text (Sarvam bulbul:v3 via backend).
export async function fetchTTS(text, languageCode = "en-IN") {
  const { data } = await api.post("/signup/tts", { text, language_code: languageCode });
  return new Audio(`data:${data.mime || "audio/wav"};base64,${data.audio_b64}`);
}

// DexWave reads a `levels` array. The interview has no analyser — this file
// records to a MediaRecorder and posts the blob, and there is no live
// amplitude anywhere in that path. So rather than fake a spectrum, the
// ribbons are driven by a slow synthetic swell whose ENERGY says which state
// we are in: a wide swell while Dex speaks, a tighter faster one while it
// listens, near-flat when idle. It is honest about being a state indicator
// rather than a meter.
//
// KM-66 — moved here from VoiceInterview.js so the draft screen can use the
// same one, and CHANGED to write a REF instead of state.
//
// The original called setLevels() inside the rAF loop: a React state write
// every frame, ~60 times a second, for as long as the recorder was open. In
// the interview that re-rendered one card and was survivable. On the draft
// screen it would re-render the whole assembled blueprint — three tiles, both
// pill columns, the refine panel — at 60Hz, which is the same main-thread
// starvation that made the mobile stop button miss taps in KM-60.
//
// DexWave has read `levelsRef` on its own animation frame since KM-60, so the
// wave is if anything smoother this way: it samples the newest value every
// frame instead of whatever the last render happened to commit, and the owner
// re-renders not at all.
export function useSynthLevels(state) {
  const levelsRef = useRef(new Array(12).fill(0));
  useEffect(() => {
    if (state === "idle") {
      levelsRef.current = new Array(12).fill(0);
      return undefined;
    }
    const gain = state === "listening" ? 0.85 : 0.5;
    const speed = state === "listening" ? 0.11 : 0.06;
    let t = 0, raf = 0;
    const tick = () => {
      t += speed;
      levelsRef.current = Array.from({ length: 12 }, (_, i) =>
        Math.max(0, (Math.sin(t + i * 0.7) * 0.5 + 0.5) * gain * (0.55 + 0.45 * Math.sin(t * 0.37 + i)))
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);
  return levelsRef;
}

// Mic recorder for interview answers → transcribes via public /signup/stt (Sarvam saaras:v3).
// onResult receives { text, language_code } so the caller can auto-adapt TTS to the founder's language.
export function useAnswerRecorder(onResult) {
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
          const language_code = (data?.language_code || "").trim();
          if (text) onResult({ text, language_code });
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
