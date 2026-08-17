/**
 * The Dex orb — a particle sphere that deforms to whatever the audio engine is
 * hearing.
 *
 * WHAT IT IS NOT. Not a keyframe loop, not `setInterval(randomise)`, and not a
 * circular spectrum with a bar per bin. Every particle holds a fixed position
 * on a unit sphere and is displaced along its own normal by 3D Perlin noise
 * sampled at that position, scaled by the live audio. That is what makes the
 * surface go asymmetric — the deformation is a function of WHERE a particle is,
 * so one side can swell while another is still, which a uniform scale can never
 * do.
 *
 * REACT DOES NOT RENDER FRAMES. The component mounts a canvas and a
 * requestAnimationFrame loop that reads two mutable refs — the audio engine and
 * a state box — and never calls a setter. React owns the state machine; the
 * loop owns the pixels. Sixty state updates a second would re-render the whole
 * screen sixty times a second to move some dots.
 *
 * BANDS DRIVE DIFFERENT THINGS, on purpose:
 *   low   -> large slow swells: a low-frequency, high-amplitude noise octave
 *   mid   -> the main surface detail and the ring complexity
 *   high  -> sparkle and fine jitter, the fastest-decaying of the three
 * Mapping everything to volume gives a balloon inflating; splitting the bands
 * is most of the difference between "reacting" and "alive".
 *
 * COST. One radial-gradient sprite per hue, pre-rendered once, blitted per
 * particle with `lighter` compositing. Per-particle `arc()` at ~900 particles
 * is the thing that drops frames; `drawImage` of a cached sprite does not.
 */
import { useEffect, useRef } from "react";

/* ────────────────────────────── 3D Perlin noise ────────────────────────────
   Classic Perlin, seeded so the surface is identical run to run. Inlined
   rather than pulled from a package: it is forty lines and the alternative is
   a dependency for one function. */
function makeNoise3D(seed = 20260817) {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  const grad = (h, x, y, z) => {
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  };

  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(
      lerp(
        lerp(grad(p[AA] & 15, x, y, z), grad(p[BA] & 15, x - 1, y, z), u),
        lerp(grad(p[AB] & 15, x, y - 1, z), grad(p[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(
        lerp(grad(p[AA + 1] & 15, x, y, z - 1), grad(p[BA + 1] & 15, x - 1, y, z - 1), u),
        lerp(grad(p[AB + 1] & 15, x, y - 1, z - 1), grad(p[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
      w);
  };
}

/* ─────────────────────────────── particle sprites ───────────────────────── */
const HUES = ["190, 165, 255", "140, 170, 255", "232, 226, 255"];

function makeSprite(rgb, size = 48) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(${rgb},1)`);
  grd.addColorStop(0.35, `rgba(${rgb},0.55)`);
  grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

/* ───────────────────────────── the visual states ────────────────────────── */
// Each state is a set of TARGETS. Nothing snaps: the loop eases the live values
// toward whichever target is current, which is what makes idle -> listening a
// transition rather than a cut.
const PROFILE = {
  idle:      { energy: 0.00, glow: 0.18, spin: 0.055, breathe: 0.030, audio: 0.00, ring: 0.16 },
  listening: { energy: 0.16, glow: 0.38, spin: 0.115, breathe: 0.055, audio: 1.00, ring: 0.40 },
  speaking:  { energy: 0.30, glow: 0.62, spin: 0.180, breathe: 0.060, audio: 1.00, ring: 0.62 },
  thinking:  { energy: 0.42, glow: 0.50, spin: 0.300, breathe: 0.090, audio: 0.00, ring: 0.55 },
};

/**
 * @param {object} engineRef   ref holding a DexAudioEngine (or null)
 * @param {object} stateRef    ref holding one of PROFILE's keys — read every
 *                             frame, so changing it never re-renders React
 * @param {number} [density]   0..1 particle-count multiplier
 */
export function DexOrb({ engineRef, stateRef, className, density = 1 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return undefined;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const noise = makeNoise3D();
    const sprites = HUES.map((h) => makeSprite(h));

    // Particle budget: honest about the device, and cut hard under reduced
    // motion, where the spec asks for fewer particles rather than a frozen orb.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const base = reduced ? 320 : 900;
    const COUNT = Math.max(220, Math.round(base * density * (dpr > 1.5 ? 1 : 0.8)));

    // Even distribution — the golden-angle spiral, not random, because random
    // points clump and the clumps read as defects once the surface deforms.
    const P = new Float32Array(COUNT * 3);
    const seedArr = new Float32Array(COUNT * 2); // size seed, phase
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < COUNT; i++) {
      const y = 1 - (i / (COUNT - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = golden * i;
      P[i * 3] = Math.cos(th) * r;
      P[i * 3 + 1] = y;
      P[i * 3 + 2] = Math.sin(th) * r;
      seedArr[i * 2] = 0.6 + ((i * 2654435761) % 1000) / 1000 * 0.9;
      seedArr[i * 2 + 1] = ((i * 40503) % 628) / 100;
    }

    // Live, eased values. These are what actually get drawn; PROFILE holds
    // where they are heading.
    const live = { energy: 0, glow: 0.18, spin: 0.055, breathe: 0.03, audio: 0, ring: 0.16 };
    let rotY = 0, rotX = 0, tGlobal = 0, raf = 0, last = performance.now();

    let W = 0, H = 0, R = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width));
      H = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Responsive radius — a fraction of the smaller side, so the orb keeps
      // its breathing room from a 320px phone to a desktop panel.
      R = Math.min(W, H) * 0.32;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const ease = (cur, target, k) => cur + (target - cur) * k;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      tGlobal += dt;

      const engine = engineRef?.current || null;
      const m = engine ? engine.sample(now) : { volume: 0, low: 0, mid: 0, high: 0, peak: 0 };
      const st = PROFILE[stateRef?.current] ? stateRef.current : "idle";
      const target = PROFILE[st];

      // State transitions ease over ~300-500ms; audio rides on top and is
      // already smoothed (asymmetrically) by the engine.
      live.energy = ease(live.energy, target.energy, 0.06);
      live.glow = ease(live.glow, target.glow, 0.07);
      live.spin = ease(live.spin, target.spin, 0.04);
      live.breathe = ease(live.breathe, target.breathe, 0.05);
      live.audio = ease(live.audio, target.audio, 0.08);
      live.ring = ease(live.ring, target.ring, 0.07);

      const vol = m.volume * live.audio;
      const low = m.low * live.audio;
      const mid = m.mid * live.audio;
      const high = m.high * live.audio;

      // "Thinking" ignores the microphone and runs its own travelling wave, so
      // the orb reads as working rather than as still listening.
      const think = st === "thinking" ? 1 : 0;
      const thinkWave = think * (0.5 + 0.5 * Math.sin(tGlobal * 1.7));

      rotY += (live.spin + vol * 0.55 + think * 0.25) * dt;
      rotX += (live.spin * 0.22 + low * 0.10) * dt;

      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX * 0.6), sinX = Math.sin(rotX * 0.6);
      const cx = W / 2, cy = H / 2;

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      /* ── atmospheric glow: core, mid, halo ── */
      const gA = live.glow + vol * 0.55 + m.peak * 0.22;
      const drawGlow = (radius, rgb, alpha) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        g.addColorStop(0, `rgba(${rgb},${alpha})`);
        g.addColorStop(0.5, `rgba(${rgb},${alpha * 0.28})`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      };
      drawGlow(R * 2.5, "88, 60, 190", 0.16 * gA);
      drawGlow(R * 1.5, "126, 92, 235", 0.20 * gA);
      drawGlow(R * 0.75, "196, 176, 255", 0.16 * gA);

      /* ── particles ──
         Two passes so the far hemisphere sits behind the rings and the near
         one in front, which is where the sense of depth comes from. */
      const drawHemisphere = (wantFront) => {
        for (let i = 0; i < COUNT; i++) {
          const bx = P[i * 3], by = P[i * 3 + 1], bz = P[i * 3 + 2];

          // Displacement along the particle's own normal. Three octaves, each
          // wired to a different band — this is the asymmetry.
          const nSlow = noise(bx * 1.05 + tGlobal * 0.13, by * 1.05, bz * 1.05 - tGlobal * 0.09);
          const nMid = noise(bx * 2.3, by * 2.3 + tGlobal * 0.42, bz * 2.3);
          const nFast = noise(bx * 5.2 + tGlobal * 1.15, by * 5.2, bz * 5.2 + tGlobal * 0.8);

          const breathe = live.breathe * Math.sin(tGlobal * 0.9 + seedArr[i * 2 + 1]);
          const swell = nSlow * (0.10 * live.energy + low * 0.46);
          const detail = nMid * (0.05 * live.energy + mid * 0.30);
          const jitter = nFast * (0.02 + high * 0.20);
          const wave = think * Math.sin(by * 3.4 - tGlobal * 2.6) * 0.11 * thinkWave;

          const rr = 1 + breathe + swell + detail + jitter + wave + vol * 0.16;

          // rotate: Y then X
          let x = bx * rr, y = by * rr, z = bz * rr;
          let x1 = x * cosY - z * sinY;
          let z1 = x * sinY + z * cosY;
          const y1 = y * cosX - z1 * sinX;
          z1 = y * sinX + z1 * cosX;

          const front = z1 >= 0;
          if (front !== wantFront) continue;

          // Perspective — mild, just enough for parallax between hemispheres.
          const persp = 3.0 / (3.0 - z1);
          const sx = cx + x1 * R * persp;
          const sy = cy + y1 * R * persp;

          const depth = (z1 + 1) / 2;                    // 0 back … 1 front
          const sparkle = high * 0.9 * Math.max(0, Math.sin(tGlobal * 9 + seedArr[i * 2 + 1] * 5));
          const size = seedArr[i * 2] * (1.5 + depth * 2.4) * (1 + vol * 0.85 + sparkle * 0.8) * (R / 110);
          const alpha = (0.10 + depth * 0.42) * (0.42 + live.energy * 0.5 + vol * 0.7 + sparkle * 0.5);
          if (alpha <= 0.012 || size <= 0.15) continue;

          const sprite = sprites[i % 3];
          ctx.globalAlpha = Math.min(1, alpha);
          const d = size * 3.2;
          ctx.drawImage(sprite, sx - d / 2, sy - d / 2, d, d);
        }
      };

      drawHemisphere(false);

      /* ── organic contour rings ──
         Not a spinner: the radius of each ring is noise sampled around its own
         circumference, so it undulates in place instead of sweeping. */
      const ringCount = reduced ? 1 : 2;
      for (let k = 0; k < ringCount; k++) {
        const tilt = 0.34 + k * 0.5;
        const amp = live.ring * (0.06 + mid * 0.26 + low * 0.16);
        const bright = 0.10 + live.ring * 0.20 + vol * 0.45;
        ctx.globalAlpha = Math.min(0.85, bright);
        ctx.strokeStyle = k === 0 ? "rgba(198, 176, 255, 0.95)" : "rgba(132, 160, 255, 0.75)";
        ctx.lineWidth = Math.max(0.6, (R / 190) * (1 + vol * 1.1));
        ctx.beginPath();
        const SEG = reduced ? 96 : 168;
        for (let s = 0; s <= SEG; s++) {
          const a = (s / SEG) * Math.PI * 2;
          const nx = Math.cos(a), nz = Math.sin(a);
          const wob = noise(nx * 1.8 + k * 4.1, nz * 1.8, tGlobal * 0.35 + k);
          const rad = R * (1.12 + k * 0.16) * (1 + wob * amp + vol * 0.10);
          let x = nx * rad, z = nz * rad, y = 0;
          // tilt about X, then share the sphere's Y rotation
          const yt = y * Math.cos(tilt) - z * Math.sin(tilt);
          const zt = y * Math.sin(tilt) + z * Math.cos(tilt);
          const xr = x * cosY - zt * sinY;
          const zr = x * sinY + zt * cosY;
          const persp = 3.0 / (3.0 - zr / R);
          const px = cx + xr * persp;
          const py = cy + yt * persp;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      drawHemisphere(true);

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // Mount-once: the loop reads both refs live, so it must never be torn down
    // and rebuilt when the state or the engine changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      data-testid="dex-orb-canvas"
      aria-hidden="true"
    />
  );
}

export default DexOrb;
