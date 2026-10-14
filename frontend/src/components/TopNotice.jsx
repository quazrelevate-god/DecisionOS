/* 2026-10-12 · THE TOP-NOTICE STACK — every error pill is an overlay.
 *
 * Founder: "any error … showing in a pill form or as a banner form, don't place
 * it inside the UI component area … when there is no internet there is a
 * banner with a refresh button on the Desk and it pushes the entire UI down …
 * all those pills should be an overlay toast at the top of the screen."
 *
 * So the app has ONE place for them: a column fixed under the status bar, out
 * of every page's flow. A notice renders into it with <TopNotice>, and the
 * column stacks them, so the offline pill, a "couldn't load" pill and a failed
 * Dex capture never sit on top of one another and never move the page.
 *
 * The column ignores taps (pointer-events: none) and each pill takes them back,
 * so the strip between pills is still the page underneath.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const ROOT_ID = "top-notices";

function stackRoot() {
  if (typeof document === "undefined") return null;
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.className = "top-notices";
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  return el;
}

/** Put children in the top stack. `order` sorts them (lower first). */
export function TopNotice({ children, order = 0 }) {
  const [root, setRoot] = React.useState(null);
  React.useEffect(() => { setRoot(stackRoot()); }, []);
  if (!root) return null;
  return createPortal(<div style={{ order }} className="top-notice-slot">{children}</div>, root);
}

/** The pill itself: ink, one line of words, an optional action and a close. */
export function NoticePill({ icon: Icon, tone = "ink", children, action, onClose, testid, role = "status" }) {
  return (
    <div
      role={role}
      data-testid={testid}
      className={cn(
        "pointer-events-auto flex w-full max-w-md items-center gap-2.5 rounded-[1.4rem] px-4 py-2.5 text-sm shadow-[0_14px_34px_-14px_hsl(230_30%_10%/.6)]",
        tone === "ink" ? "bg-[hsl(var(--ng-ink))] text-white" : "bg-white text-ng-ink ring-1 ring-slate-900/[0.06]",
      )}
    >
      {Icon && <Icon size={17} weight="bold" aria-hidden="true" className="shrink-0 opacity-90" />}
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
      {action}
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" data-testid={testid ? `${testid}-dismiss` : undefined}
          className={cn("-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2",
            tone === "ink" ? "text-white/70 hover:bg-white/10 hover:text-white focus-visible:ring-white/60" : "text-slate-500 hover:bg-slate-900/[0.06] focus-visible:ring-slate-900/30")}>
          <X size={14} weight="bold" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default TopNotice;
