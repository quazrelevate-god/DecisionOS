/* ASK-44 · VoiceRipple — a neumorphic ripple that listens.
 *
 * LAB ONLY, ON PURPOSE. The founder: "don't place it anywhere in our mobile
 * PWA, use the design lab page — once we finalize it we will add it to our web
 * application." So it lives under pages/designlab/, /design-lab is its only
 * call site, and it imports nothing from the app's capture pipeline: one file,
 * its own microphone, its own frame loop. Dropping it into the app later means
 * moving this file and passing it a level — nothing here reaches outward.
 *
 * ── WHAT MAKES IT NEUMORPHIC RATHER THAN A GLOWING CIRCLE ────────────────
 * The app's neumorphism has one light source and it is the top-left corner:
 * .kr-pressed is `inset 4px 4px … hsl(230 22% 34% / .22)` with
 * `inset -4px -4px … white/.72`, i.e. dark where the surface falls away from
 * the light and white where it rises into it. A ripple drawn as a flat stroke
 * would be a different material on the same page.
 * So every ring is drawn TWICE: a white arc offset up-and-left and a
 * blue-grey arc offset down-and-right, both blurred. That is a ridge in the
 * surface, lit from where everything else in the app is lit from — the wave
 * reads as the stage itself moving rather than as ink on top of it.
 *
 * ── AND WHAT MAKES IT FLUID ──────────────────────────────────────────────
 * A ring is not a circle. Its radius is r(θ) = R · (1 + Σ aᵢ·sin(kᵢθ + ωᵢt)),
 * three harmonics, and the amplitudes scale with how loud the room was when
 * that ring was born — so a quiet room sends out near-perfect circles and a
 * raised voice sends out something that wobbles as it travels. Soft edges come
 * from the blur on both strokes plus a fade that runs to zero at the rim, so
 * nothing ever ends on a hard line.
 *
 * ── THE LEVEL IS REAL ────────────────────────────────────────────────────
 * AnalyserNode on the live stream, RMS per frame, then the app's own curve
 * (Math.pow(rms * 3.2, 0.65) — the same one hooks/useDexCapture uses for the
 * dock's wave, so this surface and that one respond alike). An attack/release
 * envelope follows the voice up quickly and down slowly, which is the
 * difference between fluid and jittery.
 *
 * ── REDUCED MOTION ───────────────────────────────────────────────────────
 * Nothing travels. The stage draws its rim once and the level is shown as a
 * single ring that thickens — the app's rule since ASK-34 is that a decorative
 * animation does not run when the system asks for stillness, and a ripple is
 * decorative even when the data behind it is real.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/* The app's own metering curve (hooks/useDexCapture): RMS × 3.2 on a 0.65
   power, so ordinary speech uses the top half of the range instead of hugging
   the floor. Kept identical so this does not become a second opinion about
   what "loud" means. */
const LEVEL = (rms) => Math.min(1, Math.pow(rms * 3.2, 0.65));
const ATTACK = 0.34;   // how fast the envelope rises toward a louder frame
const RELEASE = 0.07;  // …and how slowly it falls back
const RING_MS_LOUD = 190;   // cadence at full voice
const RING_MS_QUIET = 620;  // …and in a quiet room
const LIFE_MS = 2600;       // how long a ring takes to reach the rim and go

const reduced = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function VoiceRipple({ size = 320, gain = 1, softness = 1, simulate = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState(null);
  const still = reduced();

  /* Everything the frame loop touches is a ref, not state: the loop runs at
     60fps and React does not need to hear about any of it (the same reason
     Layout drives the dock's wave from `dexLevelsRef`). */
  const levelRef = useRef(0);      // the smoothed envelope, 0..1
  const ringsRef = useRef([]);     // { born, push }
  const audioRef = useRef(null);   // { ctx, stream, analyser, data }
  const rafRef = useRef(0);
  const lastRingRef = useRef(0);
  const knobsRef = useRef({ gain, softness, simulate, live: false });
  knobsRef.current = { gain, softness, simulate, live };

  /* ── the microphone ──────────────────────────────────────────────────── */
  const stop = useCallback(() => {
    const a = audioRef.current;
    audioRef.current = null;
    if (a) {
      try { a.stream.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ }
      try { a.ctx.close(); } catch { /* already closed */ }
    }
    levelRef.current = 0;
    setLive(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error("This browser has no AudioContext.");
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      // A little smoothing in the node itself; the rest is the envelope below.
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      audioRef.current = { ctx, stream, analyser, data: new Uint8Array(analyser.fftSize) };
      setLive(true);
    } catch (e) {
      setError(
        e?.name === "NotAllowedError"
          ? "The browser blocked the microphone. Allow it for this site and press again."
          : e?.name === "NotFoundError"
            ? "No microphone on this machine."
            : e?.message || "Could not open the microphone."
      );
      setLive(false);
    }
  }, []);

  useEffect(() => stop, [stop]);

  /* ── the frame loop: read the room, move the rings, draw the surface ──── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx2d = canvas.getContext("2d");
    /* Canvas `filter` is the cleanest blur there is, and Safari only learned it
       in 17. Where it is missing the softness comes from a shadow of the
       stroke's own colour instead — a slightly tighter edge, no hard line, and
       nobody sees a crisp ripple on an old phone. */
    const hasFilter = typeof ctx2d.filter === "string";

    /* TWO PIXEL SPACES, RECONCILED — the lesson ASK-43 wrote into the Desk's
       row fit. getBoundingClientRect is in VISUAL pixels (the app is CSS
       zoomed: 0.8 on a phone, up to 1.3 on a big monitor) and offsetWidth is in
       the element's own. The backing store has to be sized in visual pixels
       times the device ratio or the ripple is soft in the wrong way; the
       drawing happens in the element's own pixels, which is what `size` means. */
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const own = canvas.offsetWidth || size;
      const zoom = rect.width ? rect.width / own : 1;
      const scale = (window.devicePixelRatio || 1) * zoom;
      canvas.width = Math.round(own * scale);
      canvas.height = Math.round(own * scale);
      ctx2d.setTransform(scale, 0, 0, scale, 0, 0);
      return own;
    };
    let box = fit();
    const refit = () => { box = fit(); };
    const ro = new ResizeObserver(refit);
    ro.observe(canvas);
    /* AND ON WINDOW RESIZE, which is not the same event. The observer fires
       when the canvas's OWN size changes; the app's zoom step changes on
       resize (hooks/useUiScale) and that leaves the element's own size exactly
       where it was — 320 own pixels before and after — so nothing above would
       have said the backing store is now the wrong number of real ones. The
       first render of this page proved it: the pane opened narrow, the canvas
       was sized for a 0.8 scale, and when the window grew into a 0.9 one the
       store stayed at 256 where it should have been 288. */
    window.addEventListener("resize", refit);

    const read = (now) => {
      const { gain: g, simulate: sim, live: isLive } = knobsRef.current;
      let raw = 0;
      if (sim) {
        /* A stand-in so the motion can be judged without granting the mic:
           two slow sines and a little noise, which is roughly the envelope of
           someone talking. Labelled in the UI — it is never a fallback for a
           real level, only an alternative to having none. */
        const t = now / 1000;
        raw = Math.max(0, 0.46 + 0.34 * Math.sin(t * 2.1) + 0.2 * Math.sin(t * 5.7 + 1.3))
          * (0.85 + 0.15 * Math.random());
      } else if (isLive && audioRef.current) {
        const { analyser, data } = audioRef.current;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        raw = LEVEL(Math.sqrt(sum / data.length));
      }
      const target = Math.min(1, raw * g);
      // Fast up, slow down: a voice's attack is sharp and its tail is not.
      const k = target > levelRef.current ? ATTACK : RELEASE;
      levelRef.current += (target - levelRef.current) * k;
      return levelRef.current;
    };

    const drawRing = (cx, cy, R, alpha, relief, wobble, phase, soft) => {
      if (R <= 2 || alpha <= 0.002) return;
      const STEPS = 96;
      const path = new Path2D();
      for (let i = 0; i <= STEPS; i += 1) {
        const th = (i / STEPS) * Math.PI * 2;
        /* Three harmonics — 2, 3 and 5 — so the shape never repeats into
           something that reads as a pattern. */
        const w = 1
          + wobble * 0.55 * Math.sin(2 * th + phase * 1.10)
          + wobble * 0.30 * Math.sin(3 * th - phase * 0.80)
          + wobble * 0.15 * Math.sin(5 * th + phase * 1.60);
        const r = R * w;
        const x = cx + Math.cos(th) * r;
        const y = cy + Math.sin(th) * r;
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      }
      path.closePath();

      /* THE RIDGE. Dark down-and-right, white up-and-left, both blurred — the
         same light the rest of the app is lit by (.kr-pressed's inset pair). */
      const off = 1 + 2.2 * relief;
      ctx2d.lineWidth = 1 + 2.6 * relief;
      ctx2d.lineJoin = "round";

      const blur = 0.6 + 2.4 * soft * (1 - relief * 0.4);
      const ridge = (dx, dy, colour) => {
        ctx2d.save();
        if (hasFilter) ctx2d.filter = `blur(${blur.toFixed(2)}px)`;
        else { ctx2d.shadowColor = colour; ctx2d.shadowBlur = blur * 2.4; }
        ctx2d.translate(dx, dy);
        ctx2d.strokeStyle = colour;
        ctx2d.stroke(path);
        ctx2d.restore();
      };
      ridge(off, off, `hsl(230 22% 34% / ${(alpha * 0.30).toFixed(3)})`);
      ridge(-off, -off, `hsl(0 0% 100% / ${(alpha * 0.85).toFixed(3)})`);
    };

    const frame = (now) => {
      rafRef.current = requestAnimationFrame(frame);
      const { softness: soft } = knobsRef.current;
      const level = read(now);
      const cx = box / 2;
      const cy = box / 2;
      const hub = box * 0.135;             // the mic's own radius
      const rim = box * 0.5 - 6;           // where a ring dies
      ctx2d.clearRect(0, 0, box, box);

      /* The aura under the mic: a soft radial bloom that breathes with the
         voice. It is the one part that is a fill rather than a ridge, because
         what it represents is light spilling out of the hub, not a ripple. */
      const auraR = hub * (1.15 + 0.9 * level);
      const aura = ctx2d.createRadialGradient(cx, cy, hub * 0.6, cx, cy, auraR);
      aura.addColorStop(0, `hsl(0 0% 100% / ${(0.40 + 0.35 * level).toFixed(3)})`);
      aura.addColorStop(1, "hsl(0 0% 100% / 0)");
      ctx2d.fillStyle = aura;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, auraR, 0, Math.PI * 2);
      ctx2d.fill();

      if (still) {
        /* Reduced motion: one ring, no travel. Its thickness is the level, so
           the surface still answers a voice — it just does not move. */
        drawRing(cx, cy, hub + (rim - hub) * 0.42, 0.55, 0.25 + 0.55 * level, 0, 0, soft);
        return;
      }

      // Emit: louder rooms send rings more often and push them harder.
      const cadence = RING_MS_QUIET - (RING_MS_QUIET - RING_MS_LOUD) * level;
      if (now - lastRingRef.current > cadence) {
        lastRingRef.current = now;
        ringsRef.current.push({ born: now, push: 0.12 + 0.88 * level });
      }

      const rings = ringsRef.current;
      for (let i = rings.length - 1; i >= 0; i -= 1) {
        const ring = rings[i];
        // Life runs faster when the ring was born loud: a shout travels.
        const age = (now - ring.born) / (LIFE_MS * (1.25 - 0.45 * ring.push));
        if (age >= 1) { rings.splice(i, 1); continue; }
        /* Ease-out so a ring leaves the hub quickly and drifts at the rim,
           which is what water does and what a linear ramp never looks like. */
        const t = 1 - Math.pow(1 - age, 2.2);
        const R = hub + (rim - hub) * t;
        // Fades to nothing at the rim; nothing ends on a hard line.
        const alpha = ring.push * Math.pow(1 - age, 1.35);
        drawRing(cx, cy, R, alpha, (1 - age) * ring.push, 0.035 * ring.push, now / 900, soft);
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      window.removeEventListener("resize", refit);
    };
  }, [size, still]);

  /* The hub's swell follows the level without a re-render: the loop writes a
     CSS variable and the halo reads it.
     THE HALO IS NOT THE BUTTON, and that is deliberate. The scale was on the
     button itself at first, which looked right and was wrong twice over: a
     control that is never geometrically still cannot be clicked by anything
     that waits for it to settle (Playwright times out on it, which is how this
     was found, and a real thumb on a moving target is the same problem in
     slower motion), and a permanent transform swallows the :active press the
     material is supposed to answer with. The swell moved to a decorative ring
     behind it; the button is exactly where the eye put it.
     The variable is written ON THE STAGE and read by inheritance, so there is
     one writer, and the number a test (or the next person) wants to look at is
     on the element they would look at first. */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      stageRef.current?.style.setProperty("--vr-level", levelRef.current.toFixed(3));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-3" ref={wrapRef}>
      <div
        ref={stageRef}
        className="relative grid place-items-center rounded-full"
        style={{ width: size, height: size }}
        data-testid="voice-ripple"
        data-live={live ? "true" : undefined}
      >
        {/* THE STAGE IS A WELL. .kr-pressed is the app's "pushed in" material
            and that is what a ripple needs to happen inside — a dish, lit from
            the top-left, with the waves running across it. */}
        <div className="kr-pressed absolute inset-0 rounded-full" aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full rounded-full"
          style={{ width: size, height: size }}
          aria-hidden="true"
        />
        {/* The hub's own swell — a ridge of the surface right at the mic's
            edge, so the button looks seated in something that is moving. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full"
          style={{
            width: size * 0.27,
            height: size * 0.27,
            transform: "scale(calc(1 + 0.085 * var(--vr-level, 0)))",
            boxShadow:
              "0 0 0 1px hsl(0 0% 100% / .9), 3px 3px 10px hsl(230 22% 34% / .16), -3px -3px 10px hsl(0 0% 100% / .9)",
          }}
        />
        <button
          type="button"
          onClick={() => (live ? stop() : start())}
          data-testid="voice-ripple-mic"
          aria-pressed={live}
          aria-label={live ? "Stop listening" : "Start listening"}
          className={[
            "relative grid place-items-center rounded-full transition-[box-shadow,transform] duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60",
            live ? "kr-pressed" : "kr-pop",
          ].join(" ")}
          style={{ width: size * 0.27, height: size * 0.27 }}
        >
          {/* The glyph is the app's own mic, drawn rather than imported so this
              file stays standalone (Phosphor's Microphone, same geometry). */}
          <svg viewBox="0 0 24 24" width={size * 0.1} height={size * 0.1} aria-hidden="true"
            fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            className="text-foreground">
            <rect x="9" y="2.5" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
            <path d="M12 17.5V21" />
          </svg>
        </button>
      </div>

      <p className="text-center text-sm text-muted-foreground" role="status">
        {error
          ? <span className="text-kr-accent">{error}</span>
          : still
            ? "Reduced motion is on, so the ripple holds still — the ring answers the level instead."
            : live
              ? "Listening — speak, and the surface answers."
              : simulate
                ? "Simulated level. Press the mic for the real one."
                : "Press the mic and speak."}
      </p>
    </div>
  );
}

export default VoiceRipple;
