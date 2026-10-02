/* The platform admin console's styles, in one place. (2026-10-03)
 *
 * Every section used to carry its own copy of the same six constants, in the
 * retired brutalist dark style (black ground, mono uppercase buttons, square
 * borders). The console is now drawn in the app's own language -- the glass
 * cards, pills and quiet labels from components/karma/glass -- so an
 * operator moving between a tenant's workspace and the console is not
 * switching products. The red stays as the console's accent, so it is never
 * mistaken for a tenant screen.
 *
 * The colours are the light-ground versions of the old ones: the dark theme's
 * #3fb950 green read at about 2:1 on white, so status text uses darker shades
 * that pass contrast. */

export const ADMIN_RED = "#cf222e";

export const CARD_BASE =
  "rounded-2xl bg-white/70 ring-1 ring-inset ring-slate-900/[0.06] shadow-[0_10px_30px_-18px_hsl(0_0%_10%/0.25)] backdrop-blur-xl";

export const ADMIN_H2 = "font-display text-xl text-slate-900";

export const ADMIN_H3 = "mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600";

export const ADMIN_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-pill border px-3.5 py-2 text-xs font-medium transition-colors disabled:opacity-50";

export const ADMIN_INP =
  "rounded-xl bg-white px-3 py-1.5 text-sm text-slate-800 ring-1 ring-inset ring-slate-900/10 outline-none placeholder:text-slate-400 focus:ring-slate-900/30";

export const ADMIN_SEL =
  "cursor-pointer rounded-xl bg-white px-3 py-1.5 text-sm text-slate-800 ring-1 ring-inset ring-slate-900/10 outline-none focus:ring-slate-900/30";
