/* The glass material the task drawer introduced (My Work), shared so every
   surface that joins it — New Task, the selection bar, Reassign — reads from
   one place instead of each file keeping its own copy of the strings.

   Black and gray on the founder's call: filled actions are a black gradient,
   secondary actions are white glass pills, and the one destructive action is
   maroon. Everything else is neutral. */

// Small-caps section label above a group of controls.
export const DRAWER_LABEL = "mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500";

// A raised glass card that groups content on the gray sheet.
export const DRAWER_CARD = "rounded-[1.4rem] bg-white/60 ring-1 ring-inset ring-white/80 shadow-[0_10px_30px_-14px_hsl(0_0%_10%/0.22)] backdrop-blur-xl";

// The white glass pill: secondary actions, people, selects.
export const GLASS_PILL = "bg-white/75 ring-1 ring-inset ring-slate-900/[0.05] shadow-[0_6px_16px_-8px_hsl(216_30%_25%/0.35),inset_0_1px_0_hsl(0_0%_100%/0.9)]";

// A round glass icon button (close, small actions).
// Its focus ring is neutral too; the app's default ring token is lavender.
export const GLASS_ICON_BTN = `grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-700 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:opacity-40 ${GLASS_PILL}`;

// The filled black-gradient pill: the action that moves things on.
export const INK_PILL = "bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] text-white shadow-[0_12px_26px_-12px_hsl(0_0%_0%/0.7),inset_0_1px_0_hsl(0_0%_100%/0.16)] transition-[filter] hover:brightness-125";

// The same pill in maroon: the one destructive action.
export const MAROON_PILL = "bg-[linear-gradient(180deg,hsl(350_52%_40%),hsl(349_62%_27%))] text-white shadow-[0_12px_26px_-12px_hsl(349_62%_22%/0.7),inset_0_1px_0_hsl(0_0%_100%/0.18)] transition-[filter] hover:brightness-110";

// Fields and segmented tracks for forms on the glass.
export const DRAWER_FIELD = "w-full rounded-2xl bg-white/80 px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 ring-1 ring-inset ring-slate-900/[0.06] shadow-[inset_0_1px_2px_hsl(216_30%_25%/0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25";
export const DRAWER_TRACK = "bg-slate-500/[0.08] ring-1 ring-inset ring-slate-900/[0.04]";
export const DRAWER_SELECT = "h-12 w-full cursor-pointer appearance-none rounded-pill bg-transparent pl-5 pr-10 text-[15px] text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:cursor-not-allowed disabled:opacity-50";

// The card-face chip (ASK-25): a soft tint, a hairline ring in the same hue,
// and text dark enough to read on it. Pair CHIP with a tone class
// ("bg-amber-50 text-amber-800 ring-amber-100"); QUIET_CHIP is the neutral one.
export const CHIP = "inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-[3px] text-[11px] font-medium leading-none ring-1 ring-inset";
export const QUIET_CHIP = "bg-slate-500/[0.07] text-slate-600 ring-slate-500/10";

// The dropdown list (2026-09-14, founder): never the operating system's. The
// panel, a row, and a group label, shared by GlassSelect and by DropdownMenu
// content so every list in the app is the same white glass. focus: overrides
// the stock menu item's accent wash.
export const GLASS_MENU = "z-[80] overflow-hidden rounded-2xl border-0 bg-white/90 text-slate-800 ring-1 ring-inset ring-slate-900/[0.06] shadow-[0_18px_44px_-18px_hsl(0_0%_0%/0.38),inset_0_1px_0_hsl(0_0%_100%/0.9)] backdrop-blur-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0";
export const GLASS_MENU_ITEM = "relative flex min-h-11 w-full cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:bg-slate-900/[0.06] focus:text-slate-900 data-[highlighted]:bg-slate-900/[0.06] data-[highlighted]:text-slate-900 data-[state=checked]:font-semibold data-[state=checked]:text-slate-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-40 lg:min-h-10";
export const GLASS_MENU_LABEL = "px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500";

// The light neutral-gray sheet dialogs sit on (Delete, Reassign).
export const GLASS_SHEET = "border-0 bg-[linear-gradient(165deg,hsl(0_0%_96%),hsl(0_0%_91%))] shadow-[0_30px_80px_-20px_hsl(0_0%_0%/0.45)]";
