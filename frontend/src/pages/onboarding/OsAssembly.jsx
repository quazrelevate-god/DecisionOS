/* YOUR OS, TAKING SHAPE (2026-10-29, founder): "they should be able to
 * visualize that something is building in parallel while they answer every
 * question… an impressive way of showing the workflow."
 *
 * One picture for the whole signup. The company sits at the centre; every
 * answer places a piece of its operating system around it — the owner and the
 * team from Basics, the trade from the website, and from the interview the
 * departments, workflows, approvals and rules Dex heard in each answer
 * (POST /signup/interview/answer → `built`). While Dex is working the hub's
 * ring turns, the links carry light and a ghost marks where the next piece
 * will land, so a wait reads as work being done.
 *
 * Motion (DESIGNER'S-PLUGINS/motion-design): Premium personality, one curve
 * (0.22, 1, 0.36, 1) for every entrance; primary = the piece landing, secondary
 * = its link drawing in behind it, ambient = the slow float and the hub's
 * breath. Held still for anyone who asks for less motion.
 *
 * Desktop draws an orbit; a phone has no room for one, so it draws a strip —
 * the hub, then the pieces flowing in beside it, newest first.
 */
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  User, UsersThree, UsersFour, Factory, Storefront, Globe, FlowArrow,
  SealCheck, CheckSquareOffset, Scales, ChartLineUp,
} from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

const EASE = [0.22, 1, 0.36, 1];

export const PIECE = {
  you: { icon: User, word: "Owner" },
  team: { icon: UsersThree, word: "Team" },
  industry: { icon: Factory, word: "Trade" },
  model: { icon: Storefront, word: "Sells" },
  web: { icon: Globe, word: "Website" },
  department: { icon: UsersFour, word: "Department" },
  workflow: { icon: FlowArrow, word: "Workflow" },
  approval: { icon: SealCheck, word: "Approval" },
  task: { icon: CheckSquareOffset, word: "Task" },
  rule: { icon: Scales, word: "Rule" },
  metric: { icon: ChartLineUp, word: "Measure" },
};

const initials = (name) => {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "OS";
  return (words[0][0] + (words[1]?.[0] || "")).toUpperCase();
};

/* Even spacing round the hub, starting at the top and going clockwise, so
   the first piece lands where the eye already is. Neighbours alternate
   between an outer and an inner ring: past six pieces one ring has no room
   for a chip's width, two staggered ones do. */
function orbitSlots(n) {
  const count = Math.max(n, 1);
  const two = count > 6;
  return Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(count, 5);
    const inner = two && i % 2 === 1;
    return { x: 50 + (inner ? 27 : 37) * Math.cos(a), y: 50 + (inner ? 29 : 41) * Math.sin(a) };
  });
}

function Hub({ name, working, size }) {
  const reduce = useReducedMotion();
  const big = size === "lg";
  return (
    <div className={cn("relative grid shrink-0 place-items-center", big ? "h-28 w-28" : "h-14 w-14")}>
      {/* Ambient: the hub breathes. */}
      <motion.span aria-hidden="true"
        className="absolute inset-0 rounded-full bg-[hsl(var(--ng-gold)/.22)] blur-xl"
        animate={reduce ? undefined : { scale: working ? [1, 1.25, 1] : [1, 1.08, 1], opacity: working ? [0.7, 1, 0.7] : [0.45, 0.6, 0.45] }}
        transition={{ duration: working ? 1.6 : 4.5, repeat: Infinity, ease: "easeInOut" }} />
      {/* Working: a gold arc turns round the hub. */}
      <motion.svg aria-hidden="true" viewBox="0 0 100 100" className="absolute -inset-2"
        animate={working && !reduce ? { rotate: 360 } : { rotate: 0 }}
        transition={working ? { duration: 2.4, repeat: Infinity, ease: "linear" } : { duration: 0.6 }}>
        <circle cx="50" cy="50" r="47" fill="none" stroke="hsl(var(--ng-gold) / .25)" strokeWidth="1.2" />
        <motion.circle cx="50" cy="50" r="47" fill="none" stroke="hsl(var(--ng-gold))" strokeWidth="2.4"
          strokeLinecap="round" strokeDasharray="60 236"
          animate={{ opacity: working ? 1 : 0 }} transition={{ duration: 0.4 }} />
      </motion.svg>
      <div className={cn(
        "relative grid place-items-center rounded-full bg-[linear-gradient(160deg,hsl(0_0%_26%),hsl(0_0%_6%))] text-white shadow-[0_14px_30px_-12px_hsl(230_30%_10%/.6),inset_0_1px_0_hsl(0_0%_100%/.18)]",
        big ? "h-24 w-24" : "h-12 w-12"
      )}>
        <span className={cn("font-display font-semibold tracking-tight", big ? "text-3xl" : "text-base")}>{initials(name)}</span>
      </div>
    </div>
  );
}

function Chip({ item, fresh, small }) {
  const P = PIECE[item.kind] || PIECE.task;
  const Icon = P.icon;
  return (
    <span className={cn(
      "flex max-w-full items-center gap-2 rounded-2xl border bg-white/75 text-left shadow-[0_8px_22px_-12px_hsl(230_30%_18%/.45)] backdrop-blur-md",
      fresh ? "border-[hsl(var(--ng-gold)/.65)] ring-2 ring-[hsl(var(--ng-gold)/.25)]" : "border-white/80",
      small ? "px-2 py-1.5" : "px-2.5 py-2"
    )}>
      <span className={cn("grid shrink-0 place-items-center rounded-xl bg-[hsl(230_15%_14%)] text-white", small ? "h-6 w-6" : "h-7 w-7")}>
        <Icon size={small ? 13 : 15} weight="bold" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[9.5px] font-semibold uppercase leading-none tracking-[0.12em] text-slate-500">{P.word}</span>
        <span title={item.label} className={cn("mt-0.5 block truncate font-medium leading-tight text-slate-900", small ? "text-[12px]" : "text-[13px]")}>{item.label}</span>
      </span>
    </span>
  );
}

/* Where the next piece will land, while Dex is still finding it. */
function Ghost({ small }) {
  return (
    <span className={cn(
      "ob-ghost block rounded-2xl border border-dashed border-slate-400/60 bg-white/30",
      small ? "h-9 w-24" : "h-11 w-32"
    )} aria-hidden="true" />
  );
}

export function OsAssembly({ hub, items = [], working = false, variant = "orbit", className }) {
  const reduce = useReducedMotion();
  const freshId = items.length ? items[items.length - 1].id : null;

  if (variant === "strip") {
    const shown = [...items].reverse().slice(0, 6);
    return (
      <section aria-label="Your OS, taking shape" data-testid="os-assembly"
        className={cn("ob-os rounded-[1.5rem] p-3", className)}>
        <div className="flex items-center gap-3">
          <Hub name={hub} working={working} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-slate-900">{hub?.trim() || "Your company"}</p>
            <p className="text-[11px] text-slate-500" data-testid="os-assembly-count">
              {items.length ? `${items.length} ${items.length === 1 ? "piece" : "pieces"} of your OS` : "Your OS builds as you answer"}
            </p>
          </div>
        </div>
        {(shown.length > 0 || working) && (
        <div className="mt-2.5 flex max-h-[5.25rem] flex-wrap content-start gap-1.5 overflow-hidden">
          {working && <Ghost small />}
          <AnimatePresence initial={false}>
            {shown.map((it) => (
              <motion.div key={it.id} layout={!reduce}
                initial={reduce ? false : { opacity: 0, scale: 0.7, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.45, ease: EASE }} className="max-w-[48%]">
                <Chip item={it} fresh={it.id === freshId} small />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        )}
      </section>
    );
  }

  const shown = items.slice(-8);
  const slots = orbitSlots(shown.length + (working ? 1 : 0));
  const hidden = items.length - shown.length;
  return (
    <section aria-label="Your OS, taking shape" data-testid="os-assembly"
      className={cn("ob-os rounded-[2rem] p-6", className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Your OS</p>
          <p className="mt-1 truncate text-lg font-semibold leading-tight text-slate-900">{hub?.trim() || "Your company"}</p>
        </div>
        <p className="shrink-0 pb-0.5 text-[11px] tabular-nums text-slate-500" data-testid="os-assembly-count">
          {items.length ? `${items.length} ${items.length === 1 ? "piece" : "pieces"}${hidden > 0 ? ` · ${shown.length} shown` : ""}` : "Builds as you answer"}
        </p>
      </div>
      <div className="relative mx-auto mt-2 aspect-square w-full max-w-[26rem]">
        {/* Secondary: each link draws in behind its piece; while Dex works,
            light runs along them toward the hub. */}
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          <circle cx="50" cy="50" r="22" fill="none" stroke="hsl(230 20% 30% / .08)" strokeWidth=".3" strokeDasharray="1 1.6" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(230 20% 30% / .07)" strokeWidth=".3" strokeDasharray="1 1.6" />
          {shown.map((it, i) => (
            <motion.line key={it.id} x1="50" y1="50" x2={slots[i].x} y2={slots[i].y}
              stroke="hsl(230 25% 25% / .28)" strokeWidth=".35"
              initial={reduce ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1, x2: slots[i].x, y2: slots[i].y }}
              transition={{ duration: 0.7, ease: EASE, delay: reduce ? 0 : 0.15 }} />
          ))}
          {/* Its own lines: the drawn ones carry framer's dash for pathLength. */}
          {working && shown.map((it, i) => (
            <line key={`flow-${it.id}`} x1={slots[i].x} y1={slots[i].y} x2="50" y2="50"
              className="ob-link-flow" strokeWidth=".45" />
          ))}
          {/* Nothing placed yet: the slots the answers will fill. */}
          {!shown.length && !working && orbitSlots(5).map((p, i) => (
            <circle key={`slot-${i}`} cx={p.x} cy={p.y} r="2.2" fill="none"
              stroke="hsl(230 20% 30% / .22)" strokeWidth=".35" strokeDasharray=".8 .8" />
          ))}
        </svg>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Hub name={hub} working={working} size="lg" />
        </div>
        <AnimatePresence initial={false}>
          {shown.map((it, i) => (
            <motion.div key={it.id} className="absolute w-max max-w-[8.5rem]"
              style={{ translateX: "-50%", translateY: "-50%" }}
              initial={reduce ? false : { left: "50%", top: "50%", opacity: 0, scale: 0.5 }}
              animate={{ left: `${slots[i].x}%`, top: `${slots[i].y}%`, opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.7, ease: EASE }}>
              {/* Ambient: every piece floats on its own phase. */}
              <motion.div animate={reduce ? undefined : { y: [0, -3, 0] }}
                transition={{ duration: 3.6 + (i % 3) * 0.7, repeat: Infinity, ease: "easeInOut", delay: i * 0.3 }}>
                <Chip item={it} fresh={it.id === freshId} />
              </motion.div>
            </motion.div>
          ))}
        </AnimatePresence>
        {working && (
          <div className="absolute" style={{ left: `${slots[shown.length].x}%`, top: `${slots[shown.length].y}%`, transform: "translate(-50%,-50%)" }}>
            <Ghost />
          </div>
        )}
      </div>
    </section>
  );
}

export default OsAssembly;
