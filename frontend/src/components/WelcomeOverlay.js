import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionTemplate, useMotionValue } from "framer-motion";
import { Microphone, Gauge, Brain, ArrowRight } from "@phosphor-icons/react";

const POINTS = [
  { icon: Microphone, title: "Speak a decision", sub: "We turn it into tasks, owners and deadlines" },
  { icon: Gauge, title: "Your CEO brief", sub: "Cash, fires and follow-ups — every morning" },
  { icon: Brain, title: "Ask your Company Brain", sub: "Any number, any customer, any answer" },
];

// KM-19 · the one-time welcome, rebuilt as glass over the real desk.
//
// WHAT THIS REPLACED. A full-bleed `bg-primary` panel in the retired indigo —
// an opaque wall between the founder and the product, decorated with square
// `border-white/20` boxes. It said "marketing screen", and the first thing it
// did was hide the thing it was welcoming you into.
//
// WHAT IT IS NOW. The Desk is already mounted and rendered behind this
// component (Layout renders it as a sibling), so instead of covering it we
// FROST it: a backdrop blur with a light wash, the founder's actual numbers
// legible-but-soft underneath. The welcome is a pane of glass held up to
// their own workspace.
//
// THE REVEAL. "Step inside" wipes the glass away through a circle that opens
// from the button itself and grows past the far corner. This is a MASK, not a
// clip: clip-path would keep the circle and throw the rest away, and what is
// wanted is the opposite — a hole. `mask-image: radial-gradient(transparent
// -> black)` punches that hole, and because the mask also clips this
// element's own backdrop-filter, the blur lifts exactly where the hole is.
// The glass does not fade out; it is cut away.
//
// WHY FRAMER DRIVES THE RADIUS AND NOT A CSS TRANSITION. The radius lives in
// a motion value that framer writes to inline style every frame, so no CSS
// transition is involved. That is deliberate on this branch: a transition on
// a custom property is the failure mode index.css documents four times over
// (see the notes on .app-sky, .app-sky__art and .kr-pop). A JS-driven value
// cannot stall the same way.
export function WelcomeOverlay() {
  const [name, setName] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const btnRef = useRef(null);

  // Origin of the cut, in viewport pixels. Defaults to centre so the effect
  // still reads if the button is never measured (reduced motion, fast click).
  const ox = useMotionValue(0);
  const oy = useMotionValue(0);
  const r = useMotionValue(0);

  const mask = useMotionTemplate`radial-gradient(circle at ${ox}px ${oy}px, transparent ${r}px, #000 calc(${r}px + 1px))`;

  useEffect(() => {
    const v = localStorage.getItem("dos_welcome");
    if (v) setName(v === "1" ? "" : v);
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem("dos_welcome");
    setName(null);
  }, []);

  const dismiss = () => {
    if (leaving) return;

    const rect = btnRef.current?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    ox.set(cx); oy.set(cy); r.set(0);

    // Far enough that the hole clears the most distant corner — otherwise the
    // last sliver of glass sits in whichever corner is furthest from the tap.
    const far = Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy));

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { clear(); return; }

    setLeaving(true);
    animate(r, far, { duration: 0.72, ease: [0.22, 1, 0.36, 1], onComplete: clear });
  };

  return (
    <AnimatePresence>
      {name !== null && (
        <motion.div
          data-testid="welcome-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          style={leaving ? { WebkitMaskImage: mask, maskImage: mask } : undefined}
          /* z ABOVE the dock. FloatingDock is z-10000 and this used to be
             z-100, so on a phone the dock floated on top of the welcome —
             unfrosted and fully tappable, which let a founder navigate away
             from a screen that had not been dismissed. It never showed on
             desktop, where there is no dock. */
          className="fixed inset-0 z-[10001] flex items-center justify-center overflow-hidden p-5
                     bg-[linear-gradient(160deg,hsl(0_0%_100%/.62),hsl(0_0%_100%/.34))]
                     backdrop-blur-2xl backdrop-saturate-150"
        >
          {/* A single warm bloom so the glass has a light source of its own
              and does not read as a flat grey sheet over the page. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-1/4 left-1/2 h-[60vh] w-[60vh] -translate-x-1/2 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, hsl(var(--kr-gold) / .30), transparent 70%)" }}
          />

          <motion.div
            className="relative w-full max-w-xl"
            animate={leaving ? { opacity: 0, scale: 0.97 } : { opacity: 1, scale: 1 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <motion.p
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="mb-4 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
            >
              Your executive office is ready
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
              className="mb-9 font-display text-4xl leading-[1.02] sm:text-5xl"
            >
              Welcome{name ? `, ${name}` : ""}.<br />Run the company from here.
            </motion.h1>

            <div className="mb-9 space-y-2.5">
              {POINTS.map((p, i) => {
                const Icon = p.icon;
                return (
                  <motion.div
                    key={p.title}
                    initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.55 + i * 0.15 }}
                    className="kr-frost-min flex items-center gap-4 rounded-2xl px-5 py-4"
                  >
                    <span className="kr-pop grid h-10 w-10 shrink-0 place-items-center rounded-full">
                      <Icon size={18} weight="bold" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{p.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{p.sub}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            <motion.button
              ref={btnRef}
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}
              onClick={dismiss}
              data-testid="welcome-dismiss"
              className="kr-pop flex h-14 items-center gap-2 rounded-pill bg-kr-ink px-9 font-medium text-white"
            >
              Step inside <ArrowRight size={18} weight="bold" />
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
