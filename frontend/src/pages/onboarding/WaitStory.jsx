/* THE WAIT, SAID (2026-10-29, the pilot client through the founder): "the user
 * is waiting so long with no prompt of loading or whatever showing."
 *
 * Every gap in the onboarding — a voice answer being written down, Dex
 * choosing the next question and finding its voice, the interview starting —
 * shows this instead of a small spinner on a button: one line that glows
 * (the same .ng-glow-text the Decide pop-up uses, no spinning dots), a short
 * story of what is happening under it that moves on as the wait does and
 * stops on its last line rather than looping, and a thin gold line that eases
 * toward the end without ever claiming to arrive before the answer does.
 */
import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "../../lib/utils";

const EASE = [0.22, 1, 0.36, 1];

export function WaitStory({ title, lines = [], expectMs = 8000, className, testid = "wait-story" }) {
  const reduce = useReducedMotion();
  const [at, setAt] = useState(0);
  useEffect(() => {
    setAt(0);
    if (lines.length < 2) return undefined;
    const step = Math.max(1400, Math.min(2600, expectMs / lines.length));
    const t = setInterval(() => setAt((i) => Math.min(i + 1, lines.length - 1)), step);
    return () => clearInterval(t);
  }, [title, lines.length, expectMs]);

  return (
    <div role="status" aria-live="polite" data-testid={testid}
      className={cn("flex flex-col items-center justify-center gap-3 py-6 text-center", className)}>
      <p className="ng-glow-text font-display text-2xl leading-tight sm:text-3xl">{title}</p>
      <div className="relative h-5 w-full overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {lines[at] && (
            <motion.p key={at} data-testid={`${testid}-line`}
              initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="text-sm text-slate-500">
              {lines[at]}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <div className="h-[3px] w-40 overflow-hidden rounded-full bg-slate-900/[0.07]" aria-hidden="true">
        <motion.div className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--ng-gold)/.6),hsl(var(--ng-gold)))]"
          initial={{ width: "4%" }} animate={{ width: "88%" }}
          transition={{ duration: expectMs / 1000, ease: [0.1, 0.6, 0.2, 1] }} />
      </div>
    </div>
  );
}

export default WaitStory;
