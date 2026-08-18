import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Microphone, Stop, PaperPlaneRight, CircleNotch, SpeakerHigh, SpeakerSlash, Waveform, CaretDown, CaretLeft, Check, Translate,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "../../lib/api";
import { fetchTTS, useAnswerRecorder, SPOKEN_LANGS, langLabel } from "./voice";

// Animated equalizer bars shown while the assistant is speaking.
const BAR_HEIGHTS = [14, 24, 18, 26, 12];
const Bars = ({ active }) => (
  <div className="flex items-end gap-1 h-6">
    {BAR_HEIGHTS.map((h, i) => (
      <motion.span key={`bar-${i}`} className="w-1 bg-brand-600"
        animate={active ? { height: [6, h, 6] } : { height: 6 }}
        transition={active ? { repeat: Infinity, duration: 0.7 + i * 0.13, ease: "easeInOut" } : { duration: 0.2 }} />
    ))}
  </div>
);

// Small chip in the header showing the assistant voice language + a picker to override mid-interview.
const LangChip = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        data-testid="interview-lang-chip"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title="Change voice language"
        className="flex items-center gap-1.5 px-2.5 h-10 border border-border bg-white text-xs font-medium hover:bg-accent disabled:opacity-40"
      >
        <span>{langLabel(value)}</span>
        <CaretDown size={12} weight="bold" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="absolute right-0 mt-1 z-20 min-w-[160px] max-h-72 overflow-y-auto border border-border bg-white shadow-md"
            data-testid="interview-lang-menu"
          >
            {SPOKEN_LANGS.map((l) => (
              <button
                key={l.code}
                data-testid={`interview-lang-option-${l.code}`}
                onClick={() => { onChange(l.code); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-brand-600/10 ${value === l.code ? "bg-brand-600/5" : ""}`}
              >
                <span className="font-semibold">{l.label}</span>
                {value === l.code && <Check size={12} weight="bold" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Step 0 — the founder picks the interview language before Dex starts.
const LanguagePick = ({ onPick, onSkip }) => (
  <div className="w-full max-w-2xl mx-auto" data-testid="signup-lang-pick">
    <p className="label-mono text-brand-600 mb-3 flex items-center gap-2"><Translate size={14} weight="bold" /> Your interview</p>
    <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl leading-[1.02] mb-2">
      Which language should Dex speak?
    </h1>
    <p className="text-sm text-muted-foreground mb-6">Dex will ask every question — voice and text — in the language you pick. You can answer by speaking or typing.</p>
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
      {SPOKEN_LANGS.map((l, i) => (
        <motion.button
          key={l.code}
          data-testid={`lang-pick-${l.code}`}
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
          onClick={() => onPick(l.code)}
          className="group border border-border bg-white p-4 text-left hover:bg-accent hover:-translate-y-0.5 transition-all"
        >
          <p className="font-heading text-2xl font-black leading-none">{l.short}</p>
          <p className="mt-2 text-xs font-medium text-muted-foreground group-hover:text-white/70">{l.label}</p>
        </motion.button>
      ))}
    </div>
    <div className="mt-6">
      <button onClick={onSkip} data-testid="interview-skip"
        className="text-xs font-medium text-muted-foreground hover:text-brand-ink underline underline-offset-4 transition-colors">
        Skip the interview — build from what you have
      </button>
    </div>
  </div>
);

export function VoiceInterview({ profile, onComplete, onSkip }) {
  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState("");
  const [why, setWhy] = useState("");
  const [index, setIndex] = useState(1);
  const [max, setMax] = useState(6);
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [phase, setPhase] = useState("pick"); // pick | starting | live
  const [lang, setLang] = useState("en-IN");
  const audioRef = useRef(null);
  const mutedRef = useRef(false);
  const inputRef = useRef(null);
  const langRef = useRef("en-IN"); // stable read for async closures
  const answerRef = useRef(""); // mirrors `answer` for async recorder callbacks

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeaking(false);
  };
  useEffect(() => stopAudio, []);

  const speak = useCallback(async (text, langCode) => {
    if (mutedRef.current || !text) return;
    stopAudio();
    try {
      const audio = await fetchTTS(text, langCode || langRef.current);
      if (mutedRef.current) return;
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      setSpeaking(true);
      await audio.play();
    } catch { setSpeaking(false); }
  }, []);

  // Reveal the question caption at the exact moment the voice starts speaking —
  // the audio is fetched FIRST, then caption + playback begin together (no lag).
  const presentQuestion = useCallback(async (data, langCode) => {
    stopAudio();
    const apply = () => {
      setQuestion(data.question); setWhy(data.why || "");
      setIndex(data.index); setMax(data.max);
      setPhase("live");
    };
    if (mutedRef.current) { apply(); return; }
    try {
      const audio = await fetchTTS(data.question, langCode || langRef.current);
      apply();
      if (mutedRef.current) return;
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      setSpeaking(true);
      await audio.play();
    } catch { apply(); setSpeaking(false); }
  }, []);

  const setLangBoth = (code) => { setLang(code); langRef.current = code; };

  const startInterview = async (code) => {
    setLangBoth(code);
    setPhase("starting");
    try {
      const { data } = await api.post("/signup/interview/start", { ...profile, language_code: code });
      setSession(data.session_id);
      await presentQuestion(data, code);
    } catch {
      toast.error("The interviewer is unavailable — building from what we have");
      onSkip(null, code);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next); mutedRef.current = next;
    if (next) stopAudio();
    else if (question) speak(question);
  };

  const pickLang = (code) => {
    if (code === langRef.current) return;
    setLangBoth(code);
    if (question && !mutedRef.current) speak(question, code);
  };

  const recorder = useAnswerRecorder(({ text }) => {
    // Voice answers go straight to the interviewer — no extra tap needed.
    const full = (answerRef.current ? `${answerRef.current} ${text}` : text).trim();
    setAnswer(full); answerRef.current = full;
    send(full);
  });

  const send = async (override) => {
    const a = (typeof override === "string" ? override : answer).trim();
    if (!a || thinking) return;
    stopAudio();
    setThinking(true);
    try {
      const { data } = await api.post("/signup/interview/answer", {
        session_id: session, answer: a, language_code: langRef.current,
      });
      if (data.done) { onComplete(session, langRef.current); return; }
      setAnswer(""); answerRef.current = "";
      await presentQuestion(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Something slipped — try again");
    } finally { setThinking(false); }
  };

  // Step back to the previous question with the earlier answer prefilled for editing.
  const goBack = async () => {
    if (thinking || index <= 1) return;
    stopAudio();
    setThinking(true);
    try {
      const { data } = await api.post("/signup/interview/back", { session_id: session });
      setAnswer(data.prev_answer || ""); answerRef.current = data.prev_answer || "";
      await presentQuestion({ question: data.question, why: "", index: data.index, max: data.max });
      inputRef.current?.focus();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't go back");
    } finally { setThinking(false); }
  };

  if (phase === "pick") {
    return <LanguagePick onPick={startInterview} onSkip={() => { stopAudio(); onSkip(null, langRef.current); }} />;
  }

  const starting = phase === "starting";
  const orbState = recorder.recording ? "listening" : speaking ? "speaking" : (thinking || starting) ? "thinking" : "idle";

  return (
    <div className="w-full max-w-2xl mx-auto" data-testid="signup-interview">
      {/* Assistant header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16">
            <motion.div className="absolute inset-0 rounded-full border-2 border-brand-600"
              animate={orbState === "listening" ? { scale: [1, 1.25, 1], opacity: [0.9, 0.25, 0.9] } :
                orbState === "speaking" ? { scale: [1, 1.12, 1], opacity: [0.7, 0.35, 0.7] } : { scale: 1, opacity: 0.25 }}
              transition={{ repeat: Infinity, duration: orbState === "listening" ? 1.1 : 1.6, ease: "easeInOut" }} />
            <div className={`absolute inset-1.5 rounded-full flex items-center justify-center border border-border transition-colors ${orbState === "listening" ? "bg-brand-600 text-white" : "bg-primary text-primary-foreground"}`}>
              {orbState === "thinking"
                ? <CircleNotch size={22} className="animate-spin" />
                : orbState === "speaking" ? <Waveform size={24} weight="bold" /> : <Microphone size={22} weight="bold" />}
            </div>
          </div>
          <div>
            <p className="font-heading font-medium tracking-tight leading-none">Dex · your COO interview</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono" data-testid="interview-progress">
              {starting ? "warming up…" : `Question ${index} · up to ${max} · ${orbState === "listening" ? "listening" : orbState === "speaking" ? "speaking" : "ready"}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Bars active={speaking} />
          <LangChip value={lang} onChange={pickLang} disabled={starting} />
          <button onClick={toggleMute} data-testid="interview-mute-toggle" title={muted ? "Unmute voice" : "Mute voice"}
            className={`w-10 h-10 flex items-center justify-center border border-border transition-colors ${muted ? "bg-white text-muted-foreground" : "bg-primary text-primary-foreground"}`}>
            {muted ? <SpeakerSlash size={18} weight="bold" /> : <SpeakerHigh size={18} weight="bold" />}
          </button>
        </div>
      </div>

      {/* Question — shown as a big caption you can read while it's spoken */}
      <div className="min-h-[150px]">
        <AnimatePresence mode="wait">
          {starting ? (
            <motion.div key="warm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="space-y-3">
              <div className="h-8 w-4/5 bg-muted animate-pulse" />
              <div className="h-8 w-3/5 bg-muted animate-pulse" />
            </motion.div>
          ) : (
            <motion.div key={question} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
              <div className="flex items-center gap-2 mb-3">
                <motion.span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${speaking ? "bg-brand-600" : "bg-black/25"}`}
                  animate={speaking ? { scale: [1, 1.6, 1], opacity: [1, 0.5, 1] } : { scale: 1, opacity: 0.5 }}
                  transition={speaking ? { repeat: Infinity, duration: 1 } : { duration: 0.2 }}
                />
                <p className="text-xs font-mono  text-muted-foreground">
                  {speaking ? "Speaking · read along" : "Read or listen"}
                </p>
              </div>
              <h1 data-testid="interview-question"
                  className={`font-heading text-2xl sm:text-3xl lg:text-4xl font-black uppercase tracking-tighter leading-[1.05] transition-colors ${speaking ? "text-brand-ink" : "text-brand-ink/85"}`}>
                {question}
              </h1>
              {why && <p className="mt-3 text-xs text-muted-foreground font-mono">Why we ask — {why}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Answer area */}
      <div className="mt-6 border border-border bg-white shadow-md p-4" data-testid="interview-answer-box">
        <textarea
          ref={inputRef}
          data-testid="interview-answer-input"
          rows={3}
          value={answer}
          disabled={starting || thinking}
          onChange={(e) => { setAnswer(e.target.value); answerRef.current = e.target.value; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={recorder.recording ? "Listening… tap Stop when done — your answer sends itself" : "Tap the mic and speak, or type your answer…"}
          className="w-full bg-transparent text-base focus:outline-none resize-none placeholder:text-black/30"
        />
        <div className="flex items-center justify-between mt-2 pt-3 border-t border-border">
          <button
            data-testid="interview-mic-button"
            onClick={recorder.recording ? recorder.stop : recorder.start}
            disabled={starting || thinking || recorder.transcribing}
            className={`flex items-center gap-2 px-4 py-2.5 border border-border text-xs font-medium transition-all disabled:opacity-50 ${recorder.recording ? "bg-brand-600 text-white animate-pulse" : "bg-white hover:bg-accent"}`}>
            {recorder.transcribing ? <CircleNotch size={16} className="animate-spin" />
              : recorder.recording ? <Stop size={16} weight="fill" /> : <Microphone size={16} weight="bold" />}
            {recorder.transcribing ? "Sending…" : recorder.recording ? "Stop — sends answer" : "Speak"}
          </button>
          <button onClick={() => send()} disabled={!answer.trim() || thinking || starting} data-testid="interview-send-button"
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 border border-border text-xs font-medium transition-all disabled:opacity-40">
            {thinking ? <CircleNotch size={16} className="animate-spin" /> : <PaperPlaneRight size={16} weight="bold" />}
            {thinking ? "Thinking…" : "Answer"}
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={goBack}
            disabled={index <= 1 || thinking || starting}
            data-testid="interview-back"
            title="Go back to the previous question"
            className="flex items-center gap-1 px-3 py-1.5 border border-border bg-white text-xs font-medium hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
            <CaretLeft size={12} weight="bold" /> Back
          </button>
          <div className="flex gap-1.5">
            {Array.from({ length: max }).map((_, i) => (
              <div key={`qdot-${i}`} className={`w-8 h-1.5 border border-border transition-colors ${i + 1 < index ? "bg-primary" : i + 1 === index ? "bg-brand-600" : "bg-white"}`} />
            ))}
          </div>
        </div>
        <button onClick={() => { stopAudio(); onSkip(session, langRef.current); }} data-testid="interview-skip"
          className="text-xs font-medium text-muted-foreground hover:text-brand-ink underline underline-offset-4 transition-colors">
          Skip — build from what you have
        </button>
      </div>
    </div>
  );
}
