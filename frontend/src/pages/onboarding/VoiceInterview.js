import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Microphone, Stop, PaperPlaneRight, CircleNotch, SpeakerHigh, SpeakerSlash, Waveform,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "../../lib/api";
import { fetchTTS, useAnswerRecorder } from "./voice";

// Animated equalizer bars shown while the assistant is speaking.
const BAR_HEIGHTS = [14, 24, 18, 26, 12];
const Bars = ({ active }) => (
  <div className="flex items-end gap-1 h-6">
    {BAR_HEIGHTS.map((h, i) => (
      <motion.span key={`bar-${i}`} className="w-1 bg-brand-red"
        animate={active ? { height: [6, h, 6] } : { height: 6 }}
        transition={active ? { repeat: Infinity, duration: 0.7 + i * 0.13, ease: "easeInOut" } : { duration: 0.2 }} />
    ))}
  </div>
);

export function VoiceInterview({ profile, onComplete, onSkip }) {
  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState("");
  const [why, setWhy] = useState("");
  const [index, setIndex] = useState(1);
  const [max, setMax] = useState(4);
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [starting, setStarting] = useState(true);
  const audioRef = useRef(null);
  const mutedRef = useRef(false);
  const startedRef = useRef(false);
  const inputRef = useRef(null);

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeaking(false);
  };

  const speak = useCallback(async (text) => {
    if (mutedRef.current || !text) return;
    stopAudio();
    try {
      const audio = await fetchTTS(text);
      if (mutedRef.current) return;
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      setSpeaking(true);
      await audio.play();
    } catch { setSpeaking(false); }
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next); mutedRef.current = next;
    if (next) stopAudio();
    else if (question) speak(question);
  };

  // Kick off the interview once.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const { data } = await api.post("/signup/interview/start", profile);
        setSession(data.session_id);
        setQuestion(data.question); setWhy(data.why || "");
        setIndex(data.index); setMax(data.max);
        setStarting(false);
        speak(data.question);
      } catch {
        toast.error("The interviewer is unavailable — building from what we have");
        onSkip(null);
      }
    })();
    return stopAudio;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recorder = useAnswerRecorder((text) => {
    setAnswer((a) => (a ? `${a} ${text}` : text));
    inputRef.current?.focus();
  });

  const send = async () => {
    const a = answer.trim();
    if (!a || thinking) return;
    stopAudio();
    setThinking(true);
    try {
      const { data } = await api.post("/signup/interview/answer", { session_id: session, answer: a });
      if (data.done) { onComplete(session); return; }
      setAnswer("");
      setQuestion(data.question); setWhy(data.why || "");
      setIndex(data.index); setMax(data.max);
      speak(data.question);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Something slipped — try again");
    } finally { setThinking(false); }
  };

  const orbState = recorder.recording ? "listening" : speaking ? "speaking" : (thinking || starting) ? "thinking" : "idle";

  return (
    <div className="w-full max-w-2xl mx-auto" data-testid="signup-interview">
      {/* Assistant header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16">
            <motion.div className="absolute inset-0 rounded-full border-2 border-brand-red"
              animate={orbState === "listening" ? { scale: [1, 1.25, 1], opacity: [0.9, 0.25, 0.9] } :
                orbState === "speaking" ? { scale: [1, 1.12, 1], opacity: [0.7, 0.35, 0.7] } : { scale: 1, opacity: 0.25 }}
              transition={{ repeat: Infinity, duration: orbState === "listening" ? 1.1 : 1.6, ease: "easeInOut" }} />
            <div className={`absolute inset-1.5 rounded-full flex items-center justify-center border border-black transition-colors ${orbState === "listening" ? "bg-brand-red text-white" : "bg-brand-ink text-white"}`}>
              {orbState === "thinking"
                ? <CircleNotch size={22} className="animate-spin" />
                : orbState === "speaking" ? <Waveform size={24} weight="bold" /> : <Microphone size={22} weight="bold" />}
            </div>
          </div>
          <div>
            <p className="font-heading font-black uppercase tracking-tight leading-none">Your COO interview</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono" data-testid="interview-progress">
              {starting ? "warming up…" : `Question ${index} of ${max} · ${orbState === "listening" ? "listening" : orbState === "speaking" ? "speaking" : "ready"}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Bars active={speaking} />
          <button onClick={toggleMute} data-testid="interview-mute-toggle" title={muted ? "Unmute voice" : "Mute voice"}
            className={`w-10 h-10 flex items-center justify-center border border-black transition-colors ${muted ? "bg-white text-muted-foreground" : "bg-brand-ink text-white"}`}>
            {muted ? <SpeakerSlash size={18} weight="bold" /> : <SpeakerHigh size={18} weight="bold" />}
          </button>
        </div>
      </div>

      {/* Question */}
      <div className="min-h-[130px]">
        <AnimatePresence mode="wait">
          {starting ? (
            <motion.div key="warm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="space-y-3">
              <div className="h-8 w-4/5 bg-black/10 animate-pulse" />
              <div className="h-8 w-3/5 bg-black/10 animate-pulse" />
            </motion.div>
          ) : (
            <motion.div key={question} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
              <h1 data-testid="interview-question" className="font-heading text-2xl sm:text-3xl lg:text-4xl font-black uppercase tracking-tighter leading-[1.05]">
                {question}
              </h1>
              {why && <p className="mt-3 text-xs text-muted-foreground font-mono">Why we ask — {why}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Answer area */}
      <div className="mt-8 border border-black bg-white shadow-brutal p-4" data-testid="interview-answer-box">
        <textarea
          ref={inputRef}
          data-testid="interview-answer-input"
          rows={3}
          value={answer}
          disabled={starting || thinking}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={recorder.recording ? "Listening… speak naturally, any language" : "Tap the mic and speak, or type your answer…"}
          className="w-full bg-transparent text-base focus:outline-none resize-none placeholder:text-black/30"
        />
        <div className="flex items-center justify-between mt-2 pt-3 border-t border-black/10">
          <button
            data-testid="interview-mic-button"
            onClick={recorder.recording ? recorder.stop : recorder.start}
            disabled={starting || thinking || recorder.transcribing}
            className={`flex items-center gap-2 px-4 py-2.5 border border-black text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50 ${recorder.recording ? "bg-brand-red text-white animate-pulse" : "bg-white hover:bg-black/5"}`}>
            {recorder.transcribing ? <CircleNotch size={16} className="animate-spin" />
              : recorder.recording ? <Stop size={16} weight="fill" /> : <Microphone size={16} weight="bold" />}
            {recorder.transcribing ? "Transcribing…" : recorder.recording ? "Done — transcribe" : "Speak"}
          </button>
          <button onClick={send} disabled={!answer.trim() || thinking || starting} data-testid="interview-send-button"
            className="flex items-center gap-2 bg-brand-ink text-white px-6 py-2.5 border border-black text-xs font-semibold uppercase tracking-wider hover:shadow-brutal-sm transition-all disabled:opacity-40">
            {thinking ? <CircleNotch size={16} className="animate-spin" /> : <PaperPlaneRight size={16} weight="bold" />}
            {thinking ? "Thinking…" : "Answer"}
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex gap-1.5">
          {Array.from({ length: max }).map((_, i) => (
            <div key={`qdot-${i}`} className={`w-8 h-1.5 border border-black transition-colors ${i + 1 < index ? "bg-brand-ink" : i + 1 === index ? "bg-brand-red" : "bg-white"}`} />
          ))}
        </div>
        <button onClick={() => { stopAudio(); onSkip(session); }} data-testid="interview-skip"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-brand-ink underline underline-offset-4 transition-colors">
          Skip — build from what you have
        </button>
      </div>
    </div>
  );
}
