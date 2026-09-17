/* The card the errands outside the app sit in (2026-09-17).
 *
 * Forgetting a password and confirming an email both start in an inbox and
 * both end at the sign-in door, so they wear the sign-in page's clothes rather
 * than inventing a third look. Extracted from PasswordReset.js when the
 * verify-email screen turned up needing exactly the same thing.
 *
 * `login-stage` is load-bearing, not decoration (KM-42): .kr-well is
 * neumorphic, and neumorphism needs a ground it can be lighter AND darker
 * than. Against the plain page the pane turns into a ghost — which is exactly
 * what the first pass of the reset screen was, a transparent card floating
 * over a skyline. The stage carries the picture and the glass treatment
 * measured against it.
 */
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft } from "@phosphor-icons/react";
import { KarmaLogo } from "../karma/Logo";

export const inputCls =
  "kr-pressed h-12 w-full rounded-pill bg-transparent px-4 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/40";
export const labelCls = "text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
export const primaryCls =
  "kr-lift flex h-12 w-full items-center justify-center rounded-pill bg-kr-ink text-sm font-medium text-white disabled:opacity-50";

/** @param back {{to: string, label: string}} where the corner link goes. The
 *  default is the sign-in page, which is where these errands begin; a screen
 *  reached by someone already signed in passes their own way home instead. */
export default function AuthShell({ children, testid, back }) {
  const corner = back || { to: "/login", label: "Back to sign in" };
  return (
    <div className="login-stage relative isolate flex min-h-[calc(100vh/var(--ui-scale,1))] flex-col bg-white text-foreground">
      <div className="app-sky__art app-sky__art--aside" aria-hidden="true" />
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" data-testid="auth-shell-logo">
          <KarmaLogo />
        </Link>
        <Link to={corner.to} data-testid="reset-back-to-signin"
          className="kr-pop flex h-10 items-center gap-2 rounded-pill px-4 text-sm font-medium">
          <ArrowLeft size={15} weight="bold" aria-hidden="true" /> {corner.label}
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-16">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="kr-well w-full max-w-md" data-testid={testid}>
          <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-8">{children}</div>
        </motion.div>
      </main>
    </div>
  );
}
