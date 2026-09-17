/* ASK-44 / ASK-45 / ASK-47 · VoiceRipple — a neumorphic ripple that listens.
 *
 * IT IS IN THE APP NOW. ASK-44 built it in the design lab on the founder's
 * instruction ("once we finalize it we will add it to our web application"),
 * and ASK-47 is that: it is the centrepiece of the Desk's Dex well on a phone.
 * The move is the one the header promised — the file changed folder and gained
 * a way to be handed a level from outside. Nothing else about it moved.
 *
 * TWO WAYS TO DRIVE IT.
 *   · Its own microphone, which is what the lab uses: press the hub, it opens
 *     a stream, reads it and closes it again.
 *   · Somebody else's, which is what the Desk uses: `readLevel` is a function
 *     returning 0..1 and `listening` says whether that source is live, so the
 *     ripple runs off the capture the page already owns (useDexCapture's meter)
 *     instead of opening a second stream onto the same microphone. `onPress`
 *     then belongs to the page too.
 * Give it neither and it is self-contained; give it both and it never touches
 * getUserMedia at all.
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
 * ── ASK-45 · WHAT MAKES IT WATER RATHER THAN A CIRCLE ────────────────────
 * It was three fixed sine harmonics, which is a wobble with a period: watch it
 * for ten seconds and the eye finds the repeat. Every ring now carries its own
 * RANDOM shape — a handful of control points around the circle, smoothed with
 * a Catmull-Rom curve so there are no corners, and each ring gets a fresh set.
 * Two of them, in fact: the ring is born with one and morphs into the second as
 * it travels, which is what stops the outline being a rigid object flying
 * outward. `water` is how far those points are allowed to push (0 is a perfect
 * circle), and the deformation RELAXES as the ring ages — surface tension pulls
 * a real wave back toward round, so this one does too.
 *
 * ── ASK-45 · AND THE ELASTIC RETURN ──────────────────────────────────────
 * The radius is a damped spring rather than a ramp: it rushes out, overshoots,
 * pulls back and settles into its travel. `elastic` is the size of that
 * overshoot, and the same spring rings through the ridge's depth, so a wave
 * that springs back also breathes darker and lighter as it goes.
 *
 * ── THE LEVEL IS REAL ────────────────────────────────────────────────────
 * AnalyserNode on the live stream, RMS per frame, then the app's own curve
 * (Math.pow(rms * 3.2, 0.65) — the same one hooks/useDexCapture uses for the
 * dock's wave, so this surface and that one respond alike). An attack/release
 * envelope follows the voice up quickly and down slowly, which is the
 * difference between fluid and jittery.
 *
 * ── REDUCED MOTION ───────────────────────────────────────────────────────
 * Nothing travels. One ring answers the level by thickening — the app's rule
 * since ASK-34 is that a decorative animation does not run when the system asks
 * for stillness, and a ripple is decorative even when the data behind it is
 * real.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/* The app's own metering curve (hooks/useDexCapture): RMS × 3.2 on a 0.65
   power, so ordinary speech uses the top half of the range instead of hugging
   the floor. Kept identical so this does not become a second opinion about
   what "loud" means. */
const LEVEL = (rms) => Math.min(1, Math.pow(rms * 3.2, 0.65));
const ATTACK = 0.34;   // how fast the envelope rises toward a louder frame
const RELEASE = 0.07;  // …and how slowly it falls back
const RING_MS_LOUD = 190;   // cadence at full voice, before `density`
const RING_MS_QUIET = 620;  // …and in a quiet room
const LIFE_MS = 2600;       // a ring's travel time, before `speed`
const POINTS = 7;           // control points around a ring's outline

/* ASK-45 · THE DEFAULTS ARE THE THING BEING JUDGED, so they live here in one
   block rather than scattered through the drawing code. The lab's knobs write
   these same keys; whatever the founder settles on is what gets pasted back. */
export const RIPPLE_DEFAULTS = {
  gain: 1,        // how hard a voice pushes the surface
  thickness: 1,   // how heavy a wave's ridge is
  softness: 1,    // how far the ridge blurs into the page
  water: 0.55,    // 0 = a circle · 1 = a wave with its own mind
  elastic: 0.45,  // the overshoot-and-settle as it travels
  speed: 1,       // travel time
  density: 1,     // how many waves are in flight at once
};

const reduced = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* A ring's own outline: POINTS random offsets around the circle. Two sets per
   ring (see the header) so the shape can morph while it travels. */
const seed = () => Array.from({ length: POINTS }, () => Math.random() * 2 - 1);

/* Catmull-Rom through the control points — the curve that reads as water.
   Linear interpolation would give the outline corners, and cosine gives it a
   regular bulge at every control point; this one passes through the points with
   a continuous tangent, which is why the result looks poured rather than
   drawn. */
const smooth = (ring, th) => {
  const k = ring.length;
  const x = (th / (Math.PI * 2)) * k;
  const i = Math.floor(x);
  const f = x - i;
  const p0 = ring[(i - 1 + k) % k];
  const p1 = ring[i % k];
  const p2 = ring[(i + 1) % k];
  const p3 = ring[(i + 2) % k];
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * f +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
    (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f
  );
};

export function VoiceRipple({
  size = 320,
  config = RIPPLE_DEFAULTS,
  simulate = false,
  // The external drive (see the header). `readLevel` present ⇒ no own mic.
  readLevel = null,
  listening = false,
  onPress = null,
  disabled = false,
  label,
  // How alive the surface is when nothing is being said. The founder asked for
  // "subtly waving" at rest, which is this and not zero.
  idle = 0.13,
}) {
  const external = typeof readLevel === "function";
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState(null);
  const still = reduced();

  /* Everything the frame loop touches is a ref, not state: the loop runs at
     60fps and React does not need to hear about any of it (the same reason
     Layout drives the dock's wave from `dexLevelsRef`). */
  const levelRef = useRef(0);      // the smoothed envelope, 0..1
  const ringsRef = useRef([]);     // { born, push, a, b, spin }
  const audioRef = useRef(null);   // { ctx, stream, analyser, data }
  const rafRef = useRef(0);
  const lastRingRef = useRef(0);
  const cfgRef = useRef({ ...RIPPLE_DEFAULTS, simulate, live: false });
  cfgRef.current = {
    ...RIPPLE_DEFAULTS, ...config, simulate,
    live: external ? listening : live,
    external, readLevel, idle,
  };

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

  /* ── the frame loop: read the room, move the waves, draw the surface ──── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
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
       when the canvas's OWN size changes; the app's zoom step changes on resize
       (hooks/useUiScale) and that leaves the element's own size exactly where it
       was, so nothing above would have said the backing store is now the wrong
       number of real pixels. */
    window.addEventListener("resize", refit);

    const read = (now) => {
      const { gain, simulate: sim, live: isLive, external: ext, readLevel: rl, idle: idleAmp } = cfgRef.current;
      let raw = 0;
      if (ext) {
        /* Somebody else's meter. It is already the app's own curve (the Desk
           hands over useDexCapture's, the same one this file's own reader
           uses), so it is taken as given — and when that source is not live,
           the surface breathes instead of dying, which is the "subtly waving"
           the founder asked for at rest. */
        raw = isLive ? Math.max(0, Math.min(1, Number(rl()) || 0)) : 0;
        if (!isLive) raw = idleAmp * (0.55 + 0.45 * Math.sin(now / 1400));
      } else if (sim) {
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
      const target = Math.min(1, raw * gain);
      // Fast up, slow down: a voice's attack is sharp and its tail is not.
      const k = target > levelRef.current ? ATTACK : RELEASE;
      levelRef.current += (target - levelRef.current) * k;
      return levelRef.current;
    };

    /* One wave. `shape` is the ring's own outline (two random sets, blended by
       age), `amp` how far it is allowed to push, `relief` how deep the ridge
       is, `weight` the line, `soft` the blur. */
    const drawWave = (cx, cy, R, alpha, relief, shape, amp, spin, weight, soft) => {
      if (R <= 2 || alpha <= 0.002) return;
      const STEPS = 128;
      const path = new Path2D();
      for (let i = 0; i <= STEPS; i += 1) {
        const th = (i / STEPS) * Math.PI * 2;
        const r = R * (1 + amp * shape(th + spin));
        const x = cx + Math.cos(th) * r;
        const y = cy + Math.sin(th) * r;
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      }
      path.closePath();

      /* THE RIDGE. Dark down-and-right, white up-and-left, both blurred — the
         same light the rest of the app is lit by (.kr-pressed's inset pair). */
      const off = (1 + 2.2 * relief) * Math.min(1.6, weight);
      const blur = 0.6 + 2.4 * soft * (1 - relief * 0.4);
      ctx2d.lineWidth = (1 + 2.6 * relief) * weight;
      ctx2d.lineJoin = "round";
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
      const { softness, thickness, water, elastic, speed, density } = cfgRef.current;
      const level = read(now);
      const cx = box / 2;
      const cy = box / 2;
      const hub = box * 0.135;             // the mic's own radius
      const rim = box * 0.5 - 6;           // where a wave dies
      ctx2d.clearRect(0, 0, box, box);

      /* The aura under the mic: a soft bloom that breathes with the voice. It
         is the one part that is a fill rather than a ridge, because what it
         represents is light spilling out of the hub, not a wave. */
      const auraR = hub * (1.15 + 0.9 * level);
      const aura = ctx2d.createRadialGradient(cx, cy, hub * 0.6, cx, cy, auraR);
      aura.addColorStop(0, `hsl(0 0% 100% / ${(0.40 + 0.35 * level).toFixed(3)})`);
      aura.addColorStop(1, "hsl(0 0% 100% / 0)");
      ctx2d.fillStyle = aura;
      ctx2d.beginPath();
      ctx2d.arc(cx, cy, auraR, 0, Math.PI * 2);
      ctx2d.fill();

      if (still) {
        /* Reduced motion: one ring, no travel. Its weight is the level, so the
           surface still answers a voice — it just does not move. */
        const s = seedShape(ringsRef.current[0] || (ringsRef.current[0] = newRing(0, 0.5)), 1);
        drawWave(cx, cy, hub + (rim - hub) * 0.42, 0.55, 0.25 + 0.55 * level,
          s, water * 0.05, 0, thickness, softness);
        return;
      }

      // Emit: louder rooms send waves more often, and `density` scales that.
      const cadence = (RING_MS_QUIET - (RING_MS_QUIET - RING_MS_LOUD) * level) / Math.max(0.2, density);
      if (now - lastRingRef.current > cadence) {
        lastRingRef.current = now;
        ringsRef.current.push(newRing(now, 0.12 + 0.88 * level));
      }

      const rings = ringsRef.current;
      for (let i = rings.length - 1; i >= 0; i -= 1) {
        const ring = rings[i];
        // Life runs faster when the wave was born loud: a shout travels.
        const age = (now - ring.born) / ((LIFE_MS / Math.max(0.2, speed)) * (1.25 - 0.45 * ring.push));
        if (age >= 1) { rings.splice(i, 1); continue; }

        /* ASK-45 · THE ELASTIC RETURN. The base travel is an ease-out — quick
           away from the hub, drifting at the rim. On top of it rides a damped
           oscillation: the wave overshoots, pulls back, overshoots less, and
           settles. `elastic` is how much of that is allowed, and the same term
           rings through the ridge's depth below, so a wave that springs also
           breathes darker and lighter as it goes. */
        const ease = 1 - Math.pow(1 - age, 2.2);
        const spring = Math.exp(-3.4 * age) * Math.sin(age * Math.PI * 3.1);
        const t = Math.max(0, Math.min(1.08, ease + elastic * 0.18 * spring));
        const R = hub + (rim - hub) * t;

        // Fades to nothing at the rim; nothing ends on a hard line.
        const alpha = ring.push * Math.pow(1 - age, 1.35);
        const relief = (1 - age) * ring.push * (1 + elastic * 0.35 * spring);
        /* Surface tension: the outline relaxes toward round as it travels, so a
           wave is at its most irregular where it is born. */
        const amp = water * 0.11 * ring.push * (1 - age * 0.55);
        drawWave(cx, cy, R, alpha, Math.max(0, relief), seedShape(ring, age), amp,
          ring.spin * age, thickness, softness);
      }
    };

    /* A ring's outline at a given age: its first random set morphing into its
       second, so the shape is alive while it travels rather than a rigid
       object flying outward. */
    function seedShape(ring, age) {
      const w = Math.min(1, age * 1.2);
      return (th) => smooth(ring.a, th) * (1 - w) + smooth(ring.b, th) * w;
    }
    function newRing(born, push) {
      return { born, push, a: seed(), b: seed(), spin: (Math.random() - 0.5) * 1.2 };
    }

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
    <div className="flex flex-col items-center gap-3">
      <div
        ref={stageRef}
        className="relative grid place-items-center"
        style={{ width: size, height: size }}
        data-testid="voice-ripple"
        data-live={live ? "true" : undefined}
      >
        {/* ASK-45 — NO DISH. The stage was a .kr-pressed well, which drew a hard
            circular rim around the whole thing; the founder's call is that the
            rim goes. The waves now happen on the page's own ground and the only
            edges on screen are the ones the sound makes. */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
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
          onClick={onPress || (() => (live ? stop() : start()))}
          disabled={disabled}
          data-testid="voice-ripple-mic"
          aria-pressed={external ? listening : live}
          aria-label={label || ((external ? listening : live) ? "Stop listening" : "Start listening")}
          className={[
            "relative grid place-items-center rounded-full transition-[box-shadow,transform] duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60",
            (external ? listening : live) ? "kr-pressed" : "kr-pop",
            disabled && "opacity-50",
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

      {!external && (
      <p className="text-center text-sm text-muted-foreground" role="status">
        {error
          ? <span className="text-kr-accent">{error}</span>
          : still
            ? "Reduced motion is on, so the surface holds still — the ring answers the level instead."
            : live
              ? "Listening — speak, and the surface answers."
              : simulate
                ? "Simulated level. Press the mic for the real one."
                : "Press the mic and speak."}
      </p>
      )}
    </div>
  );
}

export default VoiceRipple;
