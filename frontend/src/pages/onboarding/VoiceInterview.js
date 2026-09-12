import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Microphone, Sparkle, Stop, PaperPlaneRight, CircleNotch, SpeakerHigh, SpeakerSlash, Waveform, CaretDown, CaretLeft, Check, Translate,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "../../lib/api";
import { DexWave } from "../../components/mobile/DexWave";
import { fetchTTS, useAnswerRecorder, useSynthLevels, SPOKEN_LANGS, langLabel } from "./voice";

// KM-19 — the interview now shows the SAME voice surface the app shows.
// components/mobile/DexWave is the three-ribbon lens (white, grey, gold) that
// lives in the bottom bar when Dex is listening in-app; a founder who meets it
// here meets it again on day one, which is the whole argument for reusing it
// instead of drawing a second, different picture of "voice".
//
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
        className="kr-pop flex h-10 items-center gap-1.5 rounded-pill px-3.5 text-[11px] font-medium disabled:opacity-40"
      >
        <span>{langLabel(value)}</span>
        <CaretDown size={12} weight="bold" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="kr-frost absolute right-0 z-20 mt-2 max-h-72 min-w-[170px] overflow-y-auto rounded-2xl p-1.5"
            data-testid="interview-lang-menu"
          >
            {SPOKEN_LANGS.map((l) => (
              <button
                key={l.code}
                data-testid={`interview-lang-option-${l.code}`}
                onClick={() => { onChange(l.code); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs ${value === l.code ? "kr-pressed" : "hover:bg-white/50"}`}
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
  <div className="kr-well mx-auto w-full max-w-2xl" data-testid="signup-lang-pick">
   <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-9">
    <p className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
      <Translate size={14} weight="bold" /> Your interview
    </p>
    <h1 className="mb-2 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
      Which language should Dex speak?
    </h1>
    <p className="mb-7 text-sm text-muted-foreground">Dex will ask every question — voice and text — in the language you pick. You can answer by speaking or typing.</p>
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {SPOKEN_LANGS.map((l, i) => (
        <motion.button
          key={l.code}
          data-testid={`lang-pick-${l.code}`}
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
          onClick={() => onPick(l.code)}
          className="kr-pop rounded-2xl p-4 text-left"
        >
          <p className="text-2xl font-semibold leading-none">{l.short}</p>
          <p className="mt-2 text-[11px] font-medium text-muted-foreground">{l.label}</p>
        </motion.button>
      ))}
    </div>
    <div className="mt-7">
      <button onClick={onSkip} data-testid="interview-skip"
        className="kr-pop flex h-10 items-center rounded-pill px-5 text-xs font-medium text-muted-foreground">
        Skip the interview — build from what you have
      </button>
    </div>
   </div>
  </div>
);

/* KM-62 — the question types itself, finishing when the voice does.
   Founder: "add a typewriting each-character animation on the response text
   from the AI bot; the speed should be such that the audio length and the
   printing animation end at approximately the same time."

   So the pace is DERIVED, not chosen: total audio milliseconds divided by
   character count. A long answer spoken slowly types slowly; a short one
   snaps. The caption stops being a subtitle running on its own clock and
   becomes the same utterance, written down as it is said.

   Driven by requestAnimationFrame against a wall-clock start rather than a
   per-character setInterval: an interval accumulates its own drift and would
   arrive seconds late on a long question, which is the one thing this is
   supposed to avoid. Only a change in the character COUNT commits state, so a
   60fps loop costs one render per character, not per frame.

   `durationMs` of 0 means muted or a TTS failure — there is no voice to match,
   so it falls back to a comfortable reading cadence. */
function useTypewriter(text, durationMs) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (!text) { setShown(""); return undefined; }
    const total = durationMs > 0 ? durationMs : text.length * 38;
    // Never slower than the voice: finishing a touch early reads as keeping up,
    // finishing late reads as lagging.
    const perChar = Math.max(8, (total * 0.94) / text.length);
    let count = -1;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const next = Math.min(text.length, Math.floor((now - t0) / perChar));
      if (next !== count) { count = next; setShown(text.slice(0, next)); }
      if (count < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, durationMs]);
  return shown;
}

export function VoiceInterview({ profile, onComplete, onSkip, onBack }) {
  const [session, setSession] = useState(null);
  const [question, setQuestion] = useState("");
  const [why, setWhy] = useState("");
  const [index, setIndex] = useState(1);
  const [max, setMax] = useState(6);
  const [answer, setAnswer] = useState("");
  const [audioMs, setAudioMs] = useState(0);
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
    const apply = (ms = 0) => {
      setAudioMs(ms);
      setQuestion(data.question); setWhy(data.why || "");
      setIndex(data.index); setMax(data.max);
      setPhase("live");
    };
    if (mutedRef.current) { apply(); return; }
    try {
      const audio = await fetchTTS(data.question, langCode || langRef.current);
      /* Read the clip's true length so the typewriter can match it. The src is
         a data: URI so metadata is usually there already; the listener covers
         the case where it is not, and the 700ms cap means a browser that never
         reports duration delays the caption by at most that, then falls back
         to the reading cadence rather than hanging. */
      const ms = await new Promise((res) => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) return res(audio.duration * 1000);
        const settle = () => res(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0);
        audio.addEventListener("loadedmetadata", settle, { once: true });
        setTimeout(() => res(0), 700);
      });
      apply(ms);
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
    if (thinking) return;
    /* KM-62 — at the first question there is no earlier answer to return to,
       so Back leaves the interview and hands control to the previous PHASE.
       It used to be inert here, which is what made the flow feel one-way:
       the founder could revise any answer except the moment they had just
       committed to being interviewed at all. */
    if (index <= 1) { stopAudio(); onBack?.(); return; }
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

  // Derived BEFORE the "pick" early return: useSynthLevels is a hook, and a
  // hook after a conditional return runs in a different order on the render
  // where that branch is taken.
  const starting = phase === "starting";
  const orbState = recorder.recording ? "listening" : speaking ? "speaking" : (thinking || starting) ? "thinking" : "idle";
  // KM-66 — a REF now, read by DexWave on its own frame. See voice.js.
  const levelsRef = useSynthLevels(orbState === "listening" ? "listening" : orbState === "speaking" ? "speaking" : "idle");
  // Paced off the clip that is playing right now — see useTypewriter.
  const typedQuestion = useTypewriter(question, audioMs);

  if (phase === "pick") {
    return <LanguagePick onPick={startInterview} onSkip={() => { stopAudio(); onSkip(null, langRef.current); }} />;
  }

  return (
    <div className="kr-well mx-auto w-full max-w-2xl" data-testid="signup-interview">
     <div className="kr-well__pane rounded-[1.75rem] p-5 sm:p-8">
      {/* Assistant header. The ribbons carry the state; the icon disc only
          names it. Both sit on ink, which is where the app puts Dex too. */}
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="kr-pressed grid h-12 w-12 shrink-0 place-items-center rounded-full">
            {orbState === "thinking"
              ? <CircleNotch size={20} className="animate-spin" />
              : orbState === "speaking" ? <Waveform size={22} weight="bold" />
              : <Microphone size={20} weight="bold" className={orbState === "listening" ? "text-[hsl(var(--kr-gold))]" : ""} />}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-none">Dex · your COO interview</p>
            <p className="mt-1 text-xs text-muted-foreground" data-testid="interview-progress">
              {starting ? "warming up…" : `Question ${index} · up to ${max} · ${orbState === "listening" ? "listening" : orbState === "speaking" ? "speaking" : "ready"}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LangChip value={lang} onChange={pickLang} disabled={starting} />
          <button onClick={toggleMute} data-testid="interview-mute-toggle" title={muted ? "Unmute voice" : "Mute voice"}
            aria-label={muted ? "Unmute voice" : "Mute voice"}
            className={`grid h-10 w-10 place-items-center rounded-full ${muted ? "kr-pressed text-muted-foreground" : "kr-pop"}`}>
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
              <div className="kr-pressed h-8 w-4/5 animate-pulse rounded-pill" />
              <div className="kr-pressed h-8 w-3/5 animate-pulse rounded-pill" />
            </motion.div>
          ) : (
            <motion.div key={question} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
              <div className="flex items-center gap-2 mb-3">
                <motion.span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${speaking ? "bg-[hsl(var(--kr-gold))]" : "bg-foreground/25"}`}
                  animate={speaking ? { scale: [1, 1.6, 1], opacity: [1, 0.5, 1] } : { scale: 1, opacity: 0.5 }}
                  transition={speaking ? { repeat: Infinity, duration: 1 } : { duration: 0.2 }}
                />
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {speaking ? "Speaking · read along" : "Read or listen"}
                </p>
              </div>
              {/* aria-label carries the WHOLE question: a screen reader must
                  not be fed a string that grows one character at a time. */}
              <h1 data-testid="interview-question"
                  aria-label={question}
                  className={`font-display text-2xl leading-[1.06] sm:text-3xl lg:text-4xl ${speaking ? "text-foreground" : "text-foreground/85"}`}>
                {typedQuestion || "\u00a0"}
                {/* The cursor is only there while there is more to come, so a
                    finished question does not sit blinking at the founder. */}
                {typedQuestion.length < (question || "").length && (
                  <span aria-hidden="true" className="ml-0.5 inline-block h-[0.85em] w-[2px] translate-y-[0.06em] animate-pulse bg-foreground/50 align-middle" />
                )}
              </h1>
              {why && <p className="mt-3 text-xs text-muted-foreground">Why we ask — {why}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Answer area */}
      <div className="kr-frost-min mt-7 rounded-2xl p-4" data-testid="interview-answer-box">
        <textarea
          ref={inputRef}
          data-testid="interview-answer-input"
          rows={3}
          value={answer}
          disabled={starting || thinking}
          onChange={(e) => { setAnswer(e.target.value); answerRef.current = e.target.value; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={recorder.recording ? "Listening… tap Stop when done — your answer sends itself" : "Tap the mic and speak, or type your answer…"}
          className="w-full resize-none bg-transparent text-base placeholder:text-foreground/30 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/50 pt-3">
          <button
            data-testid="interview-mic-button"
            onClick={recorder.recording ? recorder.stop : recorder.start}
            disabled={starting || thinking || recorder.transcribing}
            /* KM-62 — a REAL pressed state, not a faded one. Founder: "the
               speak button's pressed state looks faded so it looks like it's
               in a disabled state."

               They were reading it correctly: `.signup-stage .kr-pressed`
               fills at 20% white with a 1px inset shadow, which on this glass
               is barely a dent — and it sat next to `disabled:opacity-50`,
               so recording and disabled looked like the same thing. The
               explicit inset shadow gives it the depth the app's other
               neumorphic controls have, and the ink ground plus gold label
               make it unmistakably ON rather than switched off. */
            className={`flex h-11 shrink-0 items-center gap-2 rounded-pill px-4 text-xs font-medium disabled:opacity-50 ${
              recorder.recording
                ? "bg-kr-ink text-[hsl(var(--kr-gold))] shadow-[inset_0_2px_5px_hsl(230_30%_8%/.55),inset_0_-1px_0_hsl(0_0%_100%/.10),0_1px_0_hsl(0_0%_100%/.45)]"
                : "kr-pop"
            }`}>
            {recorder.transcribing ? <CircleNotch size={16} className="animate-spin" />
              : recorder.recording ? <Stop size={16} weight="fill" />
              /* Dex's mark, not a microphone: the FAB, the AI-priority control
                 and the wordmark all use the sparkle, and this is Dex asking. */
              : <Sparkle size={16} weight="fill" />}
            {recorder.transcribing ? "Sending…" : recorder.recording ? "Stop — sends answer" : "Speak"}
          </button>

          {/* KM-62 — THE WAVE LIVES HERE NOW, between the two controls.
              Founder: "relocate the animating element alone to the center of
              the row between the speak button on one end and the answer button
              on the other, stretch it to accommodate the remaining space with
              no overlapping, and leave safe space around the two pills."

              It was a 112px black pill up in the header. `flex-1 min-w-0` is
              what makes it take exactly the space the two buttons do not — it
              cannot overlap them because it is a sibling in the same flex row,
              not an overlay, and the row's gap-3 is the safe space on both
              sides. min-w-0 matters: without it a flex child refuses to shrink
              below its content and would push the Answer button off the edge
              on a narrow card.

              The black fill is gone with it. That slab existed only to make
              white ribbons legible; tone="ink" makes them dark instead, so the
              wave now sits on the card's own glass — see DexWave. */}
          <div className="mx-1 hidden h-10 min-w-0 flex-1 overflow-hidden sm:block" aria-hidden="true">
            <DexWave levelsRef={levelsRef} live={orbState !== "idle"} tone="ink" />
          </div>

          <button onClick={() => send()} disabled={!answer.trim() || thinking || starting} data-testid="interview-send-button"
            className="kr-pop flex h-11 items-center gap-2 rounded-pill bg-kr-ink px-6 text-xs font-medium text-white disabled:opacity-40">
            {thinking ? <CircleNotch size={16} className="animate-spin" /> : <PaperPlaneRight size={16} weight="bold" />}
            {thinking ? "Thinking…" : "Answer"}
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={goBack}
            /* No longer disabled at question 1 — there it steps out of the
               interview instead of doing nothing. */
            disabled={thinking || starting}
            data-testid="interview-back"
            title={index <= 1 ? "Back to your world" : "Go back to the previous question"}
            className="kr-pop flex h-9 items-center gap-1 rounded-pill px-3.5 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-30">
            <CaretLeft size={12} weight="bold" /> Back
          </button>
          {/* Progress as depth: the track is pressed in, answered questions
              are filled, the live one is gold. */}
          <div className="kr-pressed hidden items-center gap-1 rounded-pill p-1 sm:flex">
            {Array.from({ length: max }).map((_, i) => (
              <div key={`qdot-${i}`}
                className={`h-1.5 w-6 rounded-pill ${i + 1 < index ? "bg-foreground/45" : i + 1 === index ? "bg-[hsl(var(--kr-gold))]" : "bg-foreground/12"}`} />
            ))}
          </div>
        </div>
        <button onClick={() => { stopAudio(); onSkip(session, langRef.current); }} data-testid="interview-skip"
          className="kr-pop flex h-9 items-center rounded-pill px-4 text-xs font-medium text-muted-foreground">
          Skip — build from what you have
        </button>
      </div>
     </div>
    </div>
  );
}
