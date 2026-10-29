/* DexBuilder — Dex as someone at work, while it reads a decision.
 *
 * The founder, 2026-10-29: the forge "was okay, but it should be human form for
 * the client… consider the entire animation box as the head, add a robotic
 * lower body with hands and legs, very subtle, as if it is preparing a
 * workflow — not cartoonish, professionally designed, smooth and fluid, in our
 * own design system."
 *
 * So the forge (DexForge, unchanged) is the head, and under it a body in the
 * same materials: the ink of the bed for the neck, torso, arms and legs, white
 * for the hands and feet (the forge's own white tiles), and gold only where
 * something is happening — the light on the chest and the steps of the
 * workflow it is building. It holds a small white board; the right hand taps
 * three steps in turn, each lights gold as it is touched and the line draws on
 * to the next, then the board clears and it starts again. The body breathes —
 * a 2.5px rise and fall — and the head follows a beat behind.
 *
 * It is a loop, like the forge, and says nothing about progress: the checklist
 * beside or under it is the honest part (DexCapturePopup).
 * Under prefers-reduced-motion it stands still, board finished.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { DexForge } from "./DexForge";

const W = 240;              // the figure's own width
const HEAD_SCALE = 0.7;     // the forge, 304 x 184, as a head
const HEAD_W = 304 * HEAD_SCALE;
const HEAD_H = 184 * HEAD_SCALE;
const BODY_H = 126;
const LEGS_H = 46;
export const BUILDER_W = W;
export const BUILDER_H = HEAD_H - 6 + BODY_H - 10 + LEGS_H;

const CYCLE = 4.8;
const EASE = [0.45, 0, 0.25, 1];
const INK_TOP = "hsl(0 0% 24%)";
const INK_BOT = "hsl(0 0% 7%)";
const GOLD = "hsl(44 88% 60%)";

/* Each hand's path to its steps and back — the left taps the first step, the
   right the second and third, so neither arm ever crosses the body. Every key
   has the same command structure, so a limb interpolates as one piece. */
const L_REST = "M84 30 Q56 62 66 100";
const L_ARM = [L_REST, "M84 30 Q62 66 87 84", "M84 30 Q62 66 87 84", L_REST, L_REST];
const L_X = [66, 87, 87, 66, 66];
const L_Y = [102, 84, 84, 102, 102];
const L_TIMES = [0, 0.12, 0.2, 0.33, 1];
const R_REST = "M156 30 Q184 62 177 100";
const R_ARM = [R_REST, R_REST, "M156 30 Q164 70 121 84", "M156 30 Q164 70 121 84",
  "M156 30 Q178 66 158 84", "M156 30 Q178 66 158 84", R_REST, R_REST];
const R_X = [177, 177, 121, 121, 158, 158, 177, 177];
const R_Y = [100, 100, 84, 84, 84, 84, 100, 100];
const R_TIMES = [0, 0.24, 0.33, 0.41, 0.54, 0.62, 0.76, 1];
const NODES = [{ x: 87, at: 0.13 }, { x: 121, at: 0.34 }, { x: 158, at: 0.55 }];

function Node({ x, at, reduced }) {
  const lit = reduced ? { fill: GOLD, r: 6.5 } : undefined;
  return (
    <g>
      <circle cx={x} cy={96} r={7} fill="white" stroke="hsl(220 13% 86%)" strokeWidth="1.5" />
      <motion.circle cx={x} cy={96} fill={GOLD}
        animate={lit || { r: [0, 0, 6.5, 6.5, 0], opacity: [0, 0, 1, 1, 0] }}
        transition={reduced ? undefined : { duration: CYCLE, times: [0, at, at + 0.04, 0.9, 1], repeat: Infinity, ease: EASE }} />
    </g>
  );
}

function Connector({ from, to, start, reduced }) {
  return (
    <motion.path d={`M${from + 8} 96 H${to - 8}`} stroke={GOLD} strokeWidth="2.5" strokeLinecap="round" fill="none"
      animate={reduced ? { pathLength: 1 } : { pathLength: [0, 0, 1, 1, 0], opacity: [1, 1, 1, 1, 0] }}
      transition={reduced ? undefined : { duration: CYCLE, times: [0, start, start + 0.16, 0.9, 1], repeat: Infinity, ease: EASE }} />
  );
}

export function DexBuilder({ label = "Dex is building what you decided" }) {
  const reduced = useReducedMotion();
  const loop = (duration, extra = {}) => (reduced ? undefined
    : { duration, repeat: Infinity, ease: "easeInOut", ...extra });

  return (
    <div className="relative mx-auto select-none" style={{ width: W, height: BUILDER_H }}
      role="img" aria-label={label} data-testid="dex-builder">
      {/* The ground shadow, breathing with the body. */}
      <motion.div aria-hidden="true"
        className="absolute bottom-[-2px] left-1/2 h-3 w-36 rounded-[50%] bg-slate-900/20 blur-[6px]"
        /* x here, not a translate class: framer owns this element's transform. */
        style={{ x: "-50%" }}
        animate={reduced ? undefined : { scaleX: [1, 0.94, 1], opacity: [0.9, 0.7, 0.9] }}
        transition={loop(2.6)} />

      {/* The legs stay planted; everything above them breathes. */}
      <svg viewBox={`0 0 ${W} ${LEGS_H}`} width={W} height={LEGS_H} aria-hidden="true"
        className="absolute bottom-0 left-0">
        <defs>
          {/* userSpaceOnUse: a straight vertical stroke has a zero-width
              box, and a box-relative gradient on it paints nothing. */}
          <linearGradient id="dxbLeg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={LEGS_H}>
            <stop offset="0" stopColor={INK_TOP} /><stop offset="1" stopColor={INK_BOT} />
          </linearGradient>
        </defs>
        <path d="M106 0 V34" stroke="url(#dxbLeg)" strokeWidth="13" strokeLinecap="round" />
        <path d="M134 0 V34" stroke="url(#dxbLeg)" strokeWidth="13" strokeLinecap="round" />
        <rect x="93" y="34" width="24" height="10" rx="5" fill="white" />
        <rect x="123" y="34" width="24" height="10" rx="5" fill="white" />
        <rect x="93" y="34" width="24" height="10" rx="5" fill="none" stroke="hsl(220 13% 84%)" strokeWidth="1" />
        <rect x="123" y="34" width="24" height="10" rx="5" fill="none" stroke="hsl(220 13% 84%)" strokeWidth="1" />
      </svg>

      <motion.div className="absolute left-0 top-0" style={{ width: W }}
        animate={reduced ? undefined : { y: [0, -2.5, 0] }} transition={loop(2.6)}>
        {/* The head — the forge itself, a beat behind the body, with the
            slightest turn toward the board while it works. */}
        <motion.div className="relative mx-auto" style={{ width: HEAD_W, height: HEAD_H }}
          animate={reduced ? undefined : { y: [0, -1.5, 0], rotate: [-0.8, 0.8, -0.8] }}
          transition={reduced ? undefined : { y: { duration: 2.6, repeat: Infinity, ease: "easeInOut", delay: 0.18 },
            rotate: { duration: CYCLE, repeat: Infinity, ease: "easeInOut" } }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: 304, transform: `scale(${HEAD_SCALE})` }}>
            <DexForge label={label} />
          </div>
        </motion.div>

        <svg viewBox={`0 0 ${W} ${BODY_H}`} width={W} height={BODY_H} aria-hidden="true"
          className="relative" style={{ marginTop: -6 }}>
          <defs>
            <linearGradient id="dxbInk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={INK_TOP} /><stop offset="1" stopColor={INK_BOT} />
            </linearGradient>
            <filter id="dxbSoft" x="-20%" y="-20%" width="140%" height="160%">
              <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="hsl(216 28% 18%)" floodOpacity=".28" />
            </filter>
          </defs>

          {/* Neck and torso: the bed's ink, with its lit top lip. */}
          <rect x="110" y="0" width="20" height="14" rx="7" fill="url(#dxbInk)" />
          <rect x="74" y="10" width="92" height="76" rx="28" fill="url(#dxbInk)" filter="url(#dxbSoft)" />
          <path d="M100 11.5 H140" stroke="white" strokeOpacity=".16" strokeWidth="1.2" strokeLinecap="round" />
          {/* The chest light: the only gold on the body, breathing slowly. */}
          <motion.circle cx="120" cy="34" r="4" fill={GOLD}
            animate={reduced ? undefined : { opacity: [0.55, 1, 0.55], r: [3.6, 4.4, 3.6] }}
            transition={loop(2.2)} />
          <circle cx="120" cy="34" r="9" fill={GOLD} opacity=".12" />

          {/* The board it is building on. */}
          <g filter="url(#dxbSoft)">
            <rect x="62" y="76" width="124" height="42" rx="13" fill="white" />
          </g>
          <rect x="62" y="76" width="124" height="42" rx="13" fill="none" stroke="hsl(220 13% 88%)" strokeWidth="1" />
          <path d="M95 96 H113 M129 96 H150" stroke="hsl(220 13% 88%)" strokeWidth="2.5" strokeLinecap="round" />
          <Connector from={87} to={121} start={0.17} reduced={reduced} />
          <Connector from={121} to={158} start={0.38} reduced={reduced} />
          {NODES.map((n) => <Node key={n.x} {...n} reduced={reduced} />)}

          {/* Both hands work: the left taps the first step, the right the
              other two; between taps each rests on its corner of the board. */}
          {[[L_ARM, L_X, L_Y, L_TIMES], [R_ARM, R_X, R_Y, R_TIMES]].map(([arm, xs, ys, times], i) => (
            <g key={i}>
              <motion.path stroke="url(#dxbInk)" strokeWidth="10" strokeLinecap="round" fill="none"
                d={arm[0]}
                animate={reduced ? { d: arm[0] } : { d: arm }}
                transition={reduced ? undefined : { duration: CYCLE, times, repeat: Infinity, ease: EASE }} />
              <motion.circle r="7" fill="white" stroke="hsl(220 13% 84%)" strokeWidth="1"
                cx={xs[0]} cy={ys[0]}
                animate={reduced ? undefined : { cx: xs, cy: ys }}
                transition={reduced ? undefined : { duration: CYCLE, times, repeat: Infinity, ease: EASE }} />
            </g>
          ))}
        </svg>
      </motion.div>
    </div>
  );
}

/* The figure in whatever box it is given, scaled to fit and centred — the
   same arrangement as DexForgeFit, for the same reasons. */
export function DexBuilderFit({ label, className, testid = "dex-builder-fit" }) {
  const boxRef = useRef(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const fit = () => {
      const s = Math.min(el.offsetWidth / BUILDER_W, el.offsetHeight / BUILDER_H, 1.15);
      setScale(s > 0 && Number.isFinite(s) ? s : 0);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} data-testid={testid} aria-hidden="true" className={`relative overflow-hidden ${className || ""}`}>
      <div className="absolute left-1/2 top-1/2 transition-opacity duration-300"
        style={{ width: BUILDER_W, height: BUILDER_H, transform: `translate(-50%, -50%) scale(${scale})`, opacity: scale ? 1 : 0 }}>
        <DexBuilder label={label} />
      </div>
    </div>
  );
}

export default DexBuilder;
