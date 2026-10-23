/* The console's own display settings and keyboard (admin console v2 P5,
 * 2026-10-23).
 *
 *   - Theme: light, dark, or the computer's setting. Dark is a scoped stylesheet
 *     (adminTheme.css) switched on by a class on <html> while the console is
 *     open, so dialogs and menus portalled to <body> follow, and the product app
 *     is never touched.
 *   - Density: comfortable or compact (tighter rows and cards for long lists).
 *   - Keys: G then a letter goes to a page, / opens Find, ? lists the keys,
 *     Shift D flips light and dark. Never while typing in a field.
 * Both settings are this browser's, like the app's own preferences. */
import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Sun, Moon, Desktop, Rows, SquareHalfBottom, Check, Keyboard } from "@phosphor-icons/react";
import { GLASS_MENU, GLASS_MENU_ITEM, GLASS_PILL } from "../../components/neuglass/glass";
import { AdminDialog, usePersisted } from "./adminUi";
import "./adminTheme.css";

export function useDisplay() {
  const [theme, setTheme] = usePersisted("theme", "light");     // light | dark | system
  const [density, setDensity] = usePersisted("density", "comfortable");
  const [systemDark, setSystemDark] = useState(() => {
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { return undefined; }
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("admin-dark", dark);
    root.classList.toggle("admin-compact", density === "compact");
    return () => { root.classList.remove("admin-dark", "admin-compact"); };
  }, [dark, density]);
  return { theme, setTheme, density, setDensity, dark };
}

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match this computer", icon: Desktop },
];
const DENSITIES = [
  { value: "comfortable", label: "Comfortable", icon: SquareHalfBottom },
  { value: "compact", label: "Compact", icon: Rows },
];

export function DisplayMenu({ display, onShortcuts }) {
  const Icon = display.dark ? Moon : Sun;
  const item = (cur, o, set) => (
    <DropdownMenu.Item key={o.value} onSelect={(e) => { e.preventDefault(); set(o.value); }}
      data-testid={`display-${o.value}`} className={GLASS_MENU_ITEM}>
      <o.icon size={16} aria-hidden="true" />
      <span className="min-w-0 flex-1">{o.label}</span>
      {cur === o.value && <Check size={14} weight="bold" aria-label="selected" />}
    </DropdownMenu.Item>
  );
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label="Display: theme and density" title="Display" data-testid="admin-display"
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-700 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 ${GLASS_PILL}`}>
          <Icon size={16} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} collisionPadding={12} className={`${GLASS_MENU} z-50 min-w-[14.5rem] p-1.5`}>
          <DropdownMenu.Label className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Theme</DropdownMenu.Label>
          {THEMES.map((o) => item(display.theme, o, display.setTheme))}
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-slate-900/[0.07]" />
          <DropdownMenu.Label className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Density</DropdownMenu.Label>
          {DENSITIES.map((o) => item(display.density, o, display.setDensity))}
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-slate-900/[0.07]" />
          <DropdownMenu.Item onSelect={onShortcuts} data-testid="display-shortcuts" className={GLASS_MENU_ITEM}>
            <Keyboard size={16} aria-hidden="true" />
            <span className="min-w-0 flex-1">Keyboard shortcuts</span>
            <kbd className="rounded-md bg-slate-900/[0.06] px-1.5 py-0.5 font-sans text-[10px] text-slate-500">?</kbd>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// G then … : the places worth a key. Letters follow the page name where they can.
export const JUMPS = [
  { key: "h", to: "", label: "Home" },
  { key: "c", to: "workspaces", label: "Customers" },
  { key: "u", to: "users", label: "Users" },
  { key: "g", to: "growth", label: "Growth" },
  { key: "e", to: "engagement", label: "Engagement" },
  { key: "t", to: "retention", label: "Retention" },
  { key: "r", to: "revenue", label: "Revenue" },
  { key: "i", to: "ai-economics", label: "AI economics" },
  { key: "s", to: "support", label: "Support desk" },
  { key: "m", to: "support/messages", label: "Messages sent" },
  { key: "b", to: "billing", label: "Billing" },
  { key: "p", to: "health", label: "Health (platform)" },
  { key: "a", to: "audit", label: "Audit log" },
];

function typing(e) {
  const el = e.target;
  if (!el || !(el instanceof Element)) return false;
  if (el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
}

export function useShortcuts({ enabled = true, go, openFind, openHelp, toggleDark }) {
  useEffect(() => {
    if (!enabled) return undefined;
    let pending = 0; // when G was pressed; the next key within 1.2 s is the place
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      const k = e.key;
      if (pending && Date.now() - pending < 1200) {
        pending = 0;
        const j = JUMPS.find((x) => x.key === k.toLowerCase());
        if (j) { e.preventDefault(); go(j.to); }
        return;
      }
      if (k === "g" || k === "G") { if (!e.shiftKey) { pending = Date.now(); return; } }
      if (k === "/") { e.preventDefault(); openFind(); return; }
      if (k === "?") { e.preventDefault(); openHelp(); return; }
      if (k === "D" && e.shiftKey) { e.preventDefault(); toggleDark(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, go, openFind, openHelp, toggleDark]);
}

const Key = ({ children }) => (
  <kbd className="inline-grid h-6 min-w-[1.5rem] place-items-center rounded-md bg-slate-900/[0.06] px-1.5 font-sans text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-900/[0.06]">{children}</kbd>
);

export function ShortcutsDialog({ open, onOpenChange }) {
  const general = [
    [["Ctrl", "K"], "Find a workspace, person or page"], [["/"], "Find, too"], [["?"], "This list"],
    [["Shift", "D"], "Light or dark"], [["Esc"], "Close a dialog or drawer"],
  ];
  return (
    <AdminDialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" wide testid="admin-shortcuts"
      description="Press G, then a letter, to go to a page. Keys do nothing while you type in a field.">
      <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Go to</h3>
          <ul className="space-y-1.5">
            {JUMPS.map((j) => (
              <li key={j.key} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                <span>{j.label}</span><span className="flex gap-1"><Key>G</Key><Key>{j.key.toUpperCase()}</Key></span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Anywhere</h3>
          <ul className="space-y-1.5">
            {general.map(([keys, label]) => (
              <li key={label} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                <span>{label}</span><span className="flex gap-1">{keys.map((k) => <Key key={k}>{k}</Key>)}</span>
              </li>
            ))}
          </ul>
          <h3 className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customers list</h3>
          <ul className="space-y-1.5">
            <li className="flex items-center justify-between gap-3 text-sm text-slate-700"><span>Quick look at a customer</span><span className="text-xs text-slate-500">the eye on its row</span></li>
          </ul>
        </section>
      </div>
    </AdminDialog>
  );
}
