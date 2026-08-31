import { motion } from "framer-motion";
import { Sparkle } from "@phosphor-icons/react";

// KM-19 · DexForge — what Dex looks like while it builds.
//
// WHAT THIS REPLACED. A brutalist robot: hard `border-border` boxes, a
// `bg-primary` torso in the retired indigo, a swinging black hammer and
// `bg-caution-50` sparks. It was drawn in a system this branch has otherwise
// finished retiring, so on a Karma surface it read as clip-art parked on
// glass — the one element on the page with 1px black outlines.
//
// WHAT IT IS NOW. The product assembling itself: a bento of tiles arriving
// one at a time into an empty bed, which is exactly what the app's home
// screens are made of.
//
// WHY THE BED IS INK. The first cut built it out of .kr-pressed with .kr-pop
// tiles, on the argument that those are the app's own materials. Rendered, it
// was invisible — .kr-pressed fills at white/30 and .kr-pop at white/38, so on
// the pale canvas it was white tiles on a white tray separated by shadows too
// soft to survive at 40px. Ink is both the fix and the more correct answer:
// every Dex surface in this app is already ink (the FAB, the Dex room, the
// "needs your decision" band), so this reads as Dex's own workshop, and white
// and gold on near-black is the strongest contrast pair the palette owns.
//
// WHY A LOOP AND NOT A PROGRESS PICTURE. The real build takes 30-60s and the
// backend reports no milestones, so any per-tile mapping would be theatre. It
// loops instead, and the honest progress lives in the bar underneath.
const TILES = [
  { key: "core",  span: "col-span-2 row-span-2", delay: 0.00, tone: "ink" },
  { key: "wide",  span: "col-span-2",            delay: 0.30, tone: "plain" },
  { key: "a",     span: "",                      delay: 0.60, tone: "gold" },
  { key: "b",     span: "",                      delay: 0.90, tone: "plain" },
  { key: "long",  span: "col-span-2",            delay: 1.20, tone: "plain" },
  { key: "gold2", span: "col-span-2",            delay: 1.50, tone: "gold" },
];

// On ink, "raised" is carried by fill and a lit top edge rather than by the
// light-zone shadow pair — .kr-pop's shadows are tuned for a pale ground and
// vanish here (the same reason index.css carries a .kr-glass.dark .kr-pop
// override).
const TONE = {
  plain: "bg-white/90 shadow-[inset_0_1px_0_hsl(0_0%_100%),0_2px_6px_hsl(0_0%_0%/.45)]",
  gold:  "bg-[hsl(var(--kr-gold))] shadow-[inset_0_1px_0_hsl(0_0%_100%/.55),0_2px_6px_hsl(0_0%_0%/.45)]",
  ink:   "bg-white/[.07] ring-1 ring-inset ring-white/20",
};

const CYCLE = 4.4;

export function DexForge({ label = "Assembling your workspace" }) {
  return (
    <div
      className="relative mx-auto w-full max-w-[19rem] select-none"
      data-testid="dex-forge"
      role="img"
      aria-label={label}
    >
      {/* The bed. Ink, with a lit inner lip so it reads as a tray with depth
          rather than a black rectangle. */}
      <div className="bg-kr-ink rounded-[1.75rem] p-3 shadow-[inset_0_1px_0_hsl(0_0%_100%/.14),0_10px_28px_-12px_hsl(216_28%_18%/.55)]">
        <div className="grid h-40 grid-cols-4 grid-rows-3 gap-2">
          {TILES.map((t) => (
            <motion.div
              key={t.key}
              className={`rounded-2xl ${t.span} ${TONE[t.tone]} flex items-center justify-center`}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0], y: [-16, 0, 0, 2], scale: [0.82, 1, 1, 0.98] }}
              transition={{
                duration: CYCLE,
                delay: t.delay,
                times: [0, 0.13, 0.85, 1],
                repeat: Infinity,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {t.tone === "ink" && (
                <motion.span
                  animate={{ opacity: [0.6, 1, 0.6], scale: [0.94, 1.06, 0.94] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                  className="text-[hsl(var(--kr-gold))]"
                >
                  <Sparkle size={26} weight="fill" aria-hidden="true" />
                </motion.span>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* The pass of light. One soft gold band travelling left to right, the
          only thing in the frame that is not material — it reads as the work
          happening rather than as another object. `mix-blend-plus-lighter`
          keeps it additive so it brightens the tiles instead of greying
          them, and the mask stops it bleeding past the bed's corners. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.75rem]">
        <motion.div
          className="absolute inset-y-0 w-28 blur-2xl mix-blend-plus-lighter"
          style={{ background: "linear-gradient(90deg, transparent, hsl(var(--kr-gold) / .40), transparent)" }}
          animate={{ x: ["-8rem", "22rem"] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.5 }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

export default DexForge;
