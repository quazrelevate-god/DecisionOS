/* THE WALKTHROUGH PLAYER (2026-10-29/30, founder): "make the actual
 * DecisionOS an animation — the whole journey inside the app, with the new
 * company's data, annotated, zoomed in, uncluttered… in a full-screen desktop
 * view, not a mock-up window, so it convinces."
 *
 * A scene is a pure function of its own progress p (0..1): `render(p)` draws
 * the screen at that instant, `camera` says where to look (a named element or
 * a point), `notes` say what to point at and when. Everything is derived from
 * one clock, so the slider can scrub to any instant and the picture is
 * exactly what playing would have shown there.
 *
 * The screen is drawn at its real size (desktop 1440×900, phone 390×844) and
 * scaled to fit the whole window. The camera zooms in and brings its focus to
 * the middle, held inside the screen's edges. Notes and their spotlight are
 * placed on the element they name as it is drawn, so a wrapped title or a
 * camera move never leaves them pointing at nothing.
 *
 * Motion (DESIGNER'S-PLUGINS/motion-design): Premium — one curve for camera
 * and entrances, beats never under ~900ms, one thing moving at a time.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Pause, Play, ArrowCounterClockwise, CaretLeft, CaretRight, X } from "@phosphor-icons/react";
import { cn } from "../../../lib/utils";

export const SCREEN = { desktop: { w: 1440, h: 900 }, phone: { w: 390, h: 844 } };

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

/* Camera keyframes [{at, x, y, s}] → the camera at p. */
function track(keys, p) {
  if (!keys?.length) return null;
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

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/* A note: a gold mark on its target and a card beside it, placed by
   placeNotes after every frame from where the target is actually drawn. */
function Note({ note }) {
  return (
    <motion.div className="pointer-events-none absolute z-20" data-for={note.target} data-side={note.side || "right"} data-kind="note"
      style={{ visibility: "hidden" }}
      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
      <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full border-2 border-[hsl(var(--ng-gold))] bg-[hsl(var(--ng-gold)/.25)]" />
      <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[hsl(var(--ng-gold))]" />
      {/* White with a gold edge: it reads on the Desk's black board and on
          the light pages alike. */}
      <div data-card className="absolute w-max max-w-[16rem] rounded-2xl border-l-[3px] border-[hsl(var(--ng-gold))] bg-white px-4 py-3 text-left text-slate-900 shadow-[0_18px_40px_-14px_hsl(230_30%_5%/.55)]">
        {note.title && <p className="text-[14px] font-semibold leading-tight">{note.title}</p>}
        {note.text && <p className={cn("text-[13px] leading-snug text-slate-600", note.title && "mt-1")}>{note.text}</p>}
      </div>
    </motion.div>
  );
}

/* The app zooms the whole page (--ui-scale: 0.9 on desktop, 0.8 on a phone):
   rects come back zoomed, styles are written unzoomed. */
const zoomOf = (el) => (el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1);

function placeNotes(layer, root) {
  if (!layer || !root) return;
  const box0 = layer.getBoundingClientRect();
  const z = zoomOf(layer);
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
    const room = { right: base.width - (x + r.width) >= 280, left: x >= 280,
      bottom: base.height - (y + r.height) >= 120, top: y >= 120 };
    const asked = node.dataset.side;
    const opposite = { right: "left", left: "right", top: "bottom", bottom: "top" }[asked];
    const side = [asked, opposite, "bottom", "top"].find((k) => room[k]) || "bottom";
    const ax = side === "right" ? x + r.width : side === "left" ? x : x + r.width / 2;
    const ay = side === "top" ? y : side === "bottom" ? y + r.height : y + r.height / 2;
    Object.assign(node.style, { left: `${ax}px`, top: `${ay}px`, visibility: "visible" });
    const card = node.querySelector("[data-card]");
    if (!card) return;
    const shift = side === "top" || side === "bottom" ? Math.min(Math.max(ax, 150), base.width - 150) - ax : 0;
    Object.assign(card.style, side === "right" ? { left: "16px", right: "", top: "50%", bottom: "", transform: "translateY(-50%)" }
      : side === "left" ? { right: "16px", left: "", top: "50%", bottom: "", transform: "translateY(-50%)" }
      : side === "top" ? { bottom: "16px", top: "", left: "50%", right: "", transform: `translateX(calc(-50% + ${shift}px))` }
      : { top: "16px", bottom: "", left: "50%", right: "", transform: `translateX(calc(-50% + ${shift}px))` });
  });
}

/* One frame of a scene at the screen's real size, scaled to `fit` — the
   summary's poster is this, so it is the tour itself, standing still. */
export function Still({ scene, p, device, fit }) {
  const size = SCREEN[device];
  return (
    <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: size.w, height: size.h, transform: `scale(${fit})` }}>
      {scene?.render(p)}
    </div>
  );
}

export function Player({ scenes, device = "desktop", autoPlay = true, testid = "walkthrough", onClose, toolbar }) {
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
  const toggle = () => { if (t >= total) { setT(0); setPlaying(true); } else setPlaying((v) => !v); };

  // The stage fills the window; the screen is the largest that fits in it.
  const stage = useRef(null);
  const room = useSize(stage);
  const fit = room.w && room.h ? Math.min(room.w / size.w, room.h / size.h) : 0;

  /* Camera keys may name an element (`target`) instead of a point: its
     centre is read from the screen in screen px and used from the next frame.
     A key with neither holds the whole screen. */
  const box = useRef(null);
  const inner = useRef(null);
  const rects = useRef({});
  const [, bump] = useState(0);
  const C = { x: size.w / 2, y: size.h / 2, s: 1 };
  const keys = (scene?.camera || [{ at: 0 }]).map((k) => {
    if (!k.target) return { ...C, ...k };
    const r = rects.current[`${scene.key}:${k.target}`];
    return r ? { at: k.at, s: k.s ?? 1, x: r.x + r.w / 2, y: r.y + r.h / 2 } : { ...C, at: k.at };
  });
  const cam = track(keys, p) || C;
  const tx = Math.min(0, Math.max(size.w - size.w * cam.s, size.w / 2 - cam.x * cam.s));
  const ty = Math.min(0, Math.max(size.h - size.h * cam.s, size.h / 2 - cam.y * cam.s));

  const live = (scene?.notes || []).filter((n) => p >= n.at[0] && p < n.at[1] && n.target);
  const liveKey = live.map((n) => n.id).join("|");
  useLayoutEffect(() => {
    const root = inner.current;
    if (root && fit && scene) {
      const want = (scene.camera || []).filter((k) => k.target).map((k) => k.target);
      if (want.length) {
        const ib = root.getBoundingClientRect();
        const k = (ib.width / size.w) || 1;
        let moved = false;
        for (const name of want) {
          const el = root.querySelector(`[data-mock="${name}"]`);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const next = { x: (r.left - ib.left) / k, y: (r.top - ib.top) / k, w: r.width / k, h: r.height / k };
          const prev = rects.current[`${scene.key}:${name}`];
          if (!prev || Math.abs(prev.x - next.x) + Math.abs(prev.y - next.y) > 1) moved = true;
          rects.current[`${scene.key}:${name}`] = next;
        }
        // Paused or scrubbed there is no next frame to pick the new aim up:
        // ask for one, once, when what the camera aims at was found or moved.
        if (moved && !playing) bump((n) => n + 1);
      }
    }
    placeNotes(box.current, inner.current);
  });
  // …and for a moment after a note appears, while things settle.
  useEffect(() => {
    let raf = 0; const until = performance.now() + 900;
    const loop = (now) => { placeNotes(box.current, inner.current); if (now < until) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [liveKey, scene?.key, fit]);

  // Keyboard: ← → between chapters, space to play, Escape to leave.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); }
      else if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const body = (
    <div className="fixed inset-0 z-[10060] flex flex-col bg-[hsl(225_8%_88%)]" data-testid={testid} role="dialog" aria-modal="true"
      aria-label="Your first week on DecisionOS">
      {/* The top bar: which chapter, the device switch, the way out. */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-[max(0.75rem,var(--sa-top))] sm:px-6">
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={scene?.key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{idx + 1} of {scenes.length} · {scene?.chapter}</p>
              <p className="truncate font-display text-lg leading-tight text-slate-900 sm:text-xl" data-testid={`${testid}-title`}>{scene?.title}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        {toolbar}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close the walkthrough" data-testid={`${testid}-close`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/80 text-slate-700 ring-1 ring-inset ring-white shadow-[0_8px_20px_-12px_hsl(230_30%_18%/.5)]">
            <X size={18} weight="bold" />
          </button>
        )}
      </div>

      {/* The stage: the app, as large as the window allows. */}
      <div ref={stage} className="relative min-h-0 flex-1">
        <div ref={box} className={cn("absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-[hsl(225_8%_92%)] shadow-[0_30px_80px_-40px_hsl(230_30%_10%/.6)]",
          device === "phone" ? "rounded-[2rem]" : "rounded-xl")}
          style={{ width: size.w * fit, height: size.h * fit }}>
          {fit > 0 && (
            <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: size.w, height: size.h, transform: `scale(${fit})` }}>
              <div ref={inner} className="absolute inset-0 origin-top-left" style={{ transform: `translate(${tx}px, ${ty}px) scale(${cam.s})` }}>
                {scene?.render(p)}
              </div>
            </div>
          )}
          {/* The spotlight: while a note speaks, everything but what it
              points at dims, so the moment has one subject. */}
          <AnimatePresence>
            {fit > 0 && live.filter((n) => n.spot !== false).slice(0, 1).map((n) => (
              <motion.div key={`spot-${scene.key}-${n.id}`} aria-hidden="true" data-for={n.target} data-kind="spot"
                className="pointer-events-none absolute z-10 rounded-[1.1rem]"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}
                style={{ visibility: "hidden", boxShadow: "0 0 0 9999px hsl(230 25% 10% / .42), 0 0 0 2px hsl(44 88% 60% / .9)" }} />
            ))}
          </AnimatePresence>
          <AnimatePresence>
            {fit > 0 && live.map((n) => <Note key={`${scene.key}-${n.id}`} note={n} />)}
          </AnimatePresence>
        </div>
      </div>

      {/* Transport: play, the slider, the chapters. */}
      <div className="shrink-0 px-4 pb-[max(0.9rem,var(--sa-bottom))] pt-2 sm:px-6">
        <div className="mx-auto max-w-5xl rounded-[1.4rem] bg-white/80 p-2.5 ring-1 ring-inset ring-white shadow-[0_14px_34px_-20px_hsl(230_30%_18%/.55)] backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button type="button" data-testid={`${testid}-play`} onClick={toggle}
              aria-label={playing ? "Pause" : t >= total ? "Play again" : "Play"}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] text-white shadow-[0_10px_22px_-10px_hsl(230_30%_10%/.6)]">
              {playing ? <Pause size={16} weight="fill" /> : t >= total ? <ArrowCounterClockwise size={16} weight="bold" /> : <Play size={16} weight="fill" />}
            </button>
            <div className="relative h-11 min-w-0 flex-1">
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
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Previous"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-slate-700 shadow-sm disabled:opacity-30"><CaretLeft size={14} weight="bold" /></button>
            <ol className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
              {scenes.map((s, i) => (
                <li key={s.key} className="shrink-0">
                  <button type="button" onClick={() => go(i)} data-testid={`${testid}-chapter-${i}`}
                    className={cn("h-8 rounded-full px-3 text-[12px] font-medium transition-colors",
                      i === idx ? "bg-[hsl(230_15%_12%)] text-white" : i < idx ? "bg-white text-slate-700" : "bg-white/60 text-slate-500")}>
                    {s.chapter}
                  </button>
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => go(idx + 1)} disabled={idx === scenes.length - 1} aria-label="Next"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-slate-700 shadow-sm disabled:opacity-30"><CaretRight size={14} weight="bold" /></button>
          </div>
        </div>
      </div>
    </div>
  );
  // Out of the signup page's tree: its glass re-styles (.signup-stage .ng-pop
  // …) must not touch the app's own components in here.
  return createPortal(body, document.body);
}

export default Player;
