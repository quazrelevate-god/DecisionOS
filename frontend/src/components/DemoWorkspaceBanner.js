/* B20 (2026-09-29) · The demo workspace says it is one.
 *
 * The login screen offers four demo seats — owner, sales, production, finance
 * — into Sharma Textiles. They are there so a reviewer, an investor or a
 * curious founder can look inside without signing up, and they work: you land
 * on a Desk with thirty decisions, real-looking money and a team. That is the
 * problem. Nothing on any screen said whose company it was.
 *
 * Three things followed from that. Somebody exploring could not tell demo data
 * from their own. There was no way out except finding Sign out in Settings.
 * And the session persists like any other, so closing the app and coming back
 * a week later dropped them straight back into Sharma Textiles — where
 * "₹4.2L overdue" reads as a fact about their business.
 *
 * So: a line that is always there while they are in it, naming the company,
 * with the two things they might want — start their own, or leave. It sits
 * above everything else on the page and is deliberately plain: it is a label,
 * not an alert, and this is not an error state.
 *
 * `tenant.is_demo` is set by the seeder and by fixup_demo_tenant, so an older
 * demo tenant gets the flag on the next boot (bootstrap/seed.py). A real
 * workspace never has it, and this renders nothing.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { Eye } from "@phosphor-icons/react";
import { useAuth } from "../context/AuthContext";

export function DemoWorkspaceBanner() {
  const { tenant, logout } = useAuth();
  // B20.1 — the eye hides the banner for THIS session (per tenant). It comes
  // back on a fresh launch on purpose: the point is you never permanently
  // forget you are looking at demo data, not your own.
  const hideKey = `demo-banner-hidden:${tenant?.id || tenant?.name || "demo"}`;
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(hideKey) === "1"; } catch { return false; }
  });
  if (!tenant?.is_demo || hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try { sessionStorage.setItem(hideKey, "1"); } catch { /* private mode */ }
  };
  return (
    <div
      data-testid="demo-banner"
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-neutral-900 px-4 py-2 text-center text-[13px] leading-snug text-white [padding-top:calc(0.5rem+var(--sa-top))] lg:[padding-top:0.5rem]"
    >
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={dismiss}
          data-testid="demo-banner-dismiss"
          aria-label="Hide this notice"
          title="Hide"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/85 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Eye size={14} weight="bold" aria-hidden="true" />
        </button>
        You&rsquo;re exploring the demo workspace{tenant?.name ? `, ${tenant.name}` : ""} — none of this is your data.
      </span>
      <span className="inline-flex items-center gap-3">
        <Link
          to="/signup"
          data-testid="demo-banner-signup"
          className="inline-flex min-h-touch items-center font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 lg:min-h-0"
        >
          Create your own
        </Link>
        <button
          type="button"
          onClick={() => logout()}
          data-testid="demo-banner-leave"
          className="inline-flex min-h-touch items-center text-white/70 underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 lg:min-h-0"
        >
          Leave
        </button>
      </span>
    </div>
  );
}

export default DemoWorkspaceBanner;
