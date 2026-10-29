/* THE WALKTHROUGH PLAYER (2026-10-29, founder): "I can't understand all of
 * it at once… make a template of the actual DecisionOS as an animation —
 * smooth motion graphics, playable through a slider — the whole journey
 * shown inside the actual UI, a simpler mockup populated with the new
 * company's data, with annotation, visual direction and floating
 * descriptions, uncluttered; zoomed in or cropped in, focused; desktop and
 * mobile."
 *
 * A scene is a pure function of its own progress p (0..1): `render(p)` draws
 * the mock screen at that instant, `camera(p)` says where to look, `notes`
 * say what to point at and when. Everything on screen is derived from one
 * clock, so the slider can scrub to any instant and the picture is exactly
 * what playing would have shown there — nothing is "already animated".
 *
 * The screen is drawn at its real size (desktop 1200×750, phone 390×844)
 * and scaled to fit; the camera zooms in and brings its focus point to the
 * middle (held inside the screen's edges), and
 * notes are placed in the un-zoomed overlay at the zoomed position of what
 * they point at, so their type never grows or blurs with the zoom.
 *
 * Motion (DESIGNER'S-PLUGINS/motion-design): Premium — one curve for camera
 * and entrances, slow enough to follow (a beat is never under ~900ms), and
 * one thing moving at a time; notes arrive after the camera settles.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Pause, Play, ArrowCounterClockwise, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "../../../lib/utils";

export const SCREEN = { desktop: { w: 1200, h: 750 }, phone: { w: 390, h: 844 } };

/* The one curve, as a function. */
export const ease = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3.2);
};
export const easeInOut = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/* 0 before a, 1 after b, eased between. */
export const span = (p, a, b, f = ease) => (p <= a ? 0 : p >= b ? 1 : f((p - a) / (b - a)));
export const lerp = (a, b, t) => a + (b - a) * t;

/* Camera keyframes [{at, x, y, s}] (x/y = focus in screen px) → the camera at p. */
export function track(keys, p) {
  if (!keys?.length) return { x: 0, y: 0, s: 1 };
  if (p <= keys[0].at) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]; const b = keys[i];
    if (p <= b.at) {
      const t = easeInOut((p - a.at) / Math.max(1e-6, b.at - a.at));
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), s: lerp(a.s, b.s, t) };
    }
  }
  return keys[keys.length - 1];
}

function useWidth(ref) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/* A note: a gold mark on its target and a card beside it. Where it sits is
   written by the player after every frame (placeNotes), from where the target
   is actually drawn — so it holds on through the camera's moves and through a
   title that wraps. The card takes its asked-for side unless that side has
   no room in the frame, then the other one. */
function Note({ note }) {
  return (
    <motion.div className="pointer-events-none absolute z-20" data-for={note.target} data-side={note.side || "right"} data-kind="note"
      style={{ visibility: "hidden" }}
      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      {/* The mark on the thing itself. */}
      <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full border-2 border-[hsl(var(--ng-gold))] bg-[hsl(var(--ng-gold)/.25)]" />
      <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[hsl(var(--ng-gold))]" />
      {/* White with a gold edge: it reads on the Desk's black board and on
          the light pages alike. */}
      <div data-card className="absolute w-max max-w-[13rem] rounded-2xl border-l-[3px] border-[hsl(var(--ng-gold))] bg-white px-3.5 py-2.5 text-left text-slate-900 shadow-[0_18px_40px_-14px_hsl(230_30%_5%/.55)]">
        {note.title && <p className="text-[13px] font-semibold leading-tight">{note.title}</p>}
        {note.text && <p className={cn("text-[12px] leading-snug text-slate-600", note.title && "mt-0.5")}>{note.text}</p>}
      </div>
    </motion.div>
  );
}

/* Put every note and spotlight in `layer` where its target in `root` is
   drawn right now. Frame px, relative to `layer`. */
function placeNotes(layer, root) {
  if (!layer || !root) return;
  const box0 = layer.getBoundingClientRect();
  /* The app zooms the whole page (--ui-scale: 0.9 on desktop, 0.8 on a
     phone): rects come back zoomed, styles are written unzoomed. */
  const z = layer.offsetWidth ? box0.width / layer.offsetWidth : 1;
  const base = { width: box0.width / z, height: box0.height / z };
  layer.querySelectorAll("[data-for]").forEach((node) => {
    const el = root.querySelector(`[data-mock="${node.dataset.for}"]`);
    if (!el) { node.style.visibility = "hidden"; return; }
    const rr = el.getBoundingClientRect();
    const r = { width: rr.width / z, height: rr.height / z };
    const x = (rr.left - box0.left) / z; const y = (rr.top - box0.top) / z;
    if (node.dataset.kind === "spot") {
      Object.assign(node.style, { left: `${x - 6}px`, top: `${y - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px`, visibility: "visible" });
      return;
    }
    // The asked-for side if it has room, else the opposite one, else below,
    // else above — the first that fits a card.
    const room = { right: base.width - (x + r.width) >= 225, left: x >= 225,
      bottom: base.height - (y + r.height) >= 110, top: y >= 110 };
    const asked = node.dataset.side;
    const opposite = { right: "left", left: "right", top: "bottom", bottom: "top" }[asked];
    const side = [asked, opposite, "bottom", "top"].find((k) => room[k]) || "bottom";
    const ax = side === "right" ? x + r.width : side === "left" ? x : x + r.width / 2;
    const ay = side === "top" ? y : side === "bottom" ? y + r.height : y + r.height / 2;
    Object.assign(node.style, { left: `${ax}px`, top: `${ay}px`, visibility: "visible" });
    const card = node.querySelector("[data-card]");
    if (!card) return;
    const shift = side === "top" || side === "bottom" ? Math.min(Math.max(ax, 130), base.width - 130) - ax : 0;
    Object.assign(card.style, side === "right" ? { left: "16px", right: "", top: "50%", bottom: "", transform: "translateY(-50%)" }
      : side === "left" ? { right: "16px", left: "", top: "50%", bottom: "", transform: "translateY(-50%)" }
      : side === "top" ? { bottom: "16px", top: "", left: "50%", right: "", transform: `translateX(calc(-50% + ${shift}px))` }
      : { top: "16px", bottom: "", left: "50%", right: "", transform: `translateX(calc(-50% + ${shift}px))` });
  });
}

export function Player({ scenes, device = "desktop", autoPlay = true, className, testid = "walkthrough" }) {
  const reduce = useReducedMotion();
  const size = SCREEN[device];
  const total = useMemo(() => scenes.reduce((k, s) => k + s.ms, 0), [scenes]);
  const starts = useMemo(() => {
    let k = 0;
    return scenes.map((s) => { const a = k; k += s.ms; return a; });
  }, [scenes]);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(autoPlay && !reduce);
  const tRef = useRef(0);
  tRef.current = t;

  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0; let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(64, now - last); last = now;
      const next = Math.min(total, tRef.current + dt);
      setT(next);
      if (next >= total) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  const idx = Math.max(0, starts.findIndex((a, i) => t >= a && (i === scenes.length - 1 || t < starts[i + 1])));
  const scene = scenes[idx];
  const p = scene ? Math.min(1, (t - starts[idx]) / scene.ms) : 0;
  const go = useCallback((i) => { setT(starts[Math.max(0, Math.min(scenes.length - 1, i))] + 1); }, [starts, scenes.length]);

  const box = useRef(null);
  const width = useWidth(box);
  const fit = width ? width / size.w : 0;
  const cam = scene?.camera ? track(scene.camera, p) : { x: size.w / 2, y: size.h / 2, s: 1 };
  /* The camera brings its focus to the middle of the screen, but never past
     an edge: a zoom near a corner shows the corner, not empty space. */
  const tx = Math.min(0, Math.max(size.w - size.w * cam.s, size.w / 2 - cam.x * cam.s));
  const ty = Math.min(0, Math.max(size.h - size.h * cam.s, size.h / 2 - cam.y * cam.s));
  const live = (scene?.notes || []).filter((n) => p >= n.at[0] && p < n.at[1]);

  const inner = useRef(null);
  const notes = live.filter((n) => n.target);
  // After every frame: notes and spotlights onto their targets as drawn.
  useLayoutEffect(() => { placeNotes(box.current, inner.current); });
  /* …and for a moment after a note appears (its target may still be
     settling — an entrance, a camera move — while nothing re-renders, as when
     paused), and whenever the frame is resized. */
  const liveKey = notes.map((n) => n.id).join("|");
  useEffect(() => {
    let raf = 0; const until = performance.now() + 900;
    const loop = (now) => { placeNotes(box.current, inner.current); if (now < until) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    const onResize = () => placeNotes(box.current, inner.current);
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [liveKey, scene?.key, width]);

  const toggle = () => { if (t >= total) { setT(0); setPlaying(true); } else setPlaying((v) => !v); };
  // Keyboard: ← → between chapters, space to play.
  const onKey = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); }
    else if (e.key === " ") { e.preventDefault(); toggle(); }
  };

  return (
    <div className={cn("w-full", className)} data-testid={testid}>
      {/* The chapter, said once, above the screen. */}
      <div className="mb-4 min-h-[3.5rem] text-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={scene?.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {idx + 1} of {scenes.length} · {scene?.chapter}
            </p>
            <p className="mt-1 font-display text-xl leading-tight text-slate-900 sm:text-2xl" data-testid={`${testid}-title`}>{scene?.title}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* The device. */}
      <div className={cn("mx-auto", device === "phone" ? "max-w-[22rem]" : "max-w-5xl")}>
        <div className={cn("relative overflow-hidden bg-[hsl(230_15%_10%)] shadow-[0_40px_90px_-40px_hsl(230_30%_10%/.7)]",
          device === "phone" ? "rounded-[2.6rem] p-2.5" : "rounded-[1.4rem] p-2")}>
          {device === "desktop" && (
            <div className="flex items-center gap-1.5 px-2 pb-2 pt-0.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" /><span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            </div>
          )}
          <div ref={box} tabIndex={0} onKeyDown={onKey} aria-label="Your first week on DecisionOS, played as a walkthrough"
            className={cn("relative w-full overflow-hidden bg-[hsl(40_14%_95%)] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ng-gold))]",
              device === "phone" ? "rounded-[2.1rem]" : "rounded-[0.9rem]")}
            style={{ aspectRatio: `${size.w} / ${size.h}` }}>
            {fit > 0 && (
              <div className="absolute left-0 top-0 origin-top-left" style={{ width: size.w, height: size.h, transform: `scale(${fit})` }}>
                <div ref={inner} className="absolute inset-0 origin-top-left" style={{ transform: `translate(${tx}px, ${ty}px) scale(${cam.s})` }}>
                  {scene?.render(p)}
                </div>
              </div>
            )}
            {/* The spotlight: while a note speaks, everything but what it points
                at dims, so the moment has one subject. A rect with a huge
                shadow is the hole; it follows the camera like the notes do. */}
            <AnimatePresence>
              {fit > 0 && notes.filter((n) => n.spot !== false).slice(0, 1).map((n) => (
                <motion.div key={`spot-${scene.key}-${n.id}`} aria-hidden="true" data-for={n.target} data-kind="spot"
                  className="pointer-events-none absolute z-10 rounded-[1.1rem]"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}
                  style={{ visibility: "hidden", boxShadow: "0 0 0 9999px hsl(230 25% 10% / .42), 0 0 0 2px hsl(44 88% 60% / .9)" }} />
              ))}
            </AnimatePresence>
            {/* Notes live outside the zoom: placed where the zoom put their target. */}
            <AnimatePresence>
              {fit > 0 && notes.map((n) => <Note key={`${scene.key}-${n.id}`} note={n} />)}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Transport: play, the slider, the chapters. */}
      <div className={cn("mx-auto mt-4", device === "phone" ? "max-w-[22rem]" : "max-w-5xl")}>
        <div className="flex items-center gap-3">
          <button type="button" data-testid={`${testid}-play`}
            onClick={toggle}
            aria-label={playing ? "Pause" : t >= total ? "Play again" : "Play"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] text-white shadow-[0_10px_22px_-10px_hsl(230_30%_10%/.6)]">
            {playing ? <Pause size={16} weight="fill" /> : t >= total ? <ArrowCounterClockwise size={16} weight="bold" /> : <Play size={16} weight="fill" />}
          </button>
          <div className="relative h-11 min-w-0 flex-1">
            {/* Chapter ticks under the track. */}
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-slate-900/10" aria-hidden="true">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--ng-gold)/.7),hsl(var(--ng-gold)))]" style={{ width: `${(t / total) * 100}%` }} />
            </div>
            {starts.slice(1).map((a) => (
              <span key={a} aria-hidden="true" className="absolute top-1/2 h-3 w-[2px] -translate-y-1/2 rounded bg-white" style={{ left: `${(a / total) * 100}%` }} />
            ))}
            <input type="range" min={0} max={total} step={10} value={t} data-testid={`${testid}-scrub`}
              onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
              aria-label="Scrub the walkthrough"
              className="ob-scrub absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent" />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Previous"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/70 text-slate-700 shadow-sm disabled:opacity-30"><CaretLeft size={14} weight="bold" /></button>
          <ol className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
            {scenes.map((s, i) => (
              <li key={s.key} className="shrink-0">
                <button type="button" onClick={() => go(i)} data-testid={`${testid}-chapter-${i}`}
                  className={cn("h-8 rounded-full px-3 text-[12px] font-medium transition-colors",
                    i === idx ? "bg-[hsl(230_15%_12%)] text-white" : i < idx ? "bg-white/80 text-slate-700" : "bg-white/50 text-slate-500")}>
                  {s.chapter}
                </button>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => go(idx + 1)} disabled={idx === scenes.length - 1} aria-label="Next"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/70 text-slate-700 shadow-sm disabled:opacity-30"><CaretRight size={14} weight="bold" /></button>
        </div>
      </div>
    </div>
  );
}

export default Player;
