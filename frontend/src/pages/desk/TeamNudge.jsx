import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { UsersThree, X } from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { hasPerm } from "../../lib/perms";
import { cn } from "../../lib/utils";

/* Audit A-16 (2026-10-08) · "BRING YOUR TEAM IN".
   Sign-up builds the teams, the pipelines and the stage work for each team —
   and then nothing ever asked the founder to bring a single person in. A
   company of one gets a fraction of the product: Dex can only hand work to
   people who are here. So until the first person is added (an invite still
   waiting counts — the owner has done their part), the Desk says so, once,
   in one line, for whoever can add people.

   "Later" puts it away for three days on this device, not for ever: it is
   the most useful next step there is, and a founder who said "later" on day
   one should hear it again on day four. */
const LATER_KEY = "dos_team_nudge_later";
const LATER_MS = 3 * 24 * 60 * 60 * 1000;

function snoozed() {
  try {
    const at = Number(localStorage.getItem(LATER_KEY) || 0);
    return at > 0 && Date.now() - at < LATER_MS;
  } catch {
    return false;
  }
}

export function TeamNudge({ className }) {
  const { user } = useAuth();
  const canAdd = hasPerm(user, "team_manage");
  const [hidden, setHidden] = useState(snoozed);
  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
    enabled: canAdd && !hidden,
  });
  const people = Array.isArray(usersQ.data) ? usersQ.data : null;
  // Only on a known answer: never flash the card while the list loads.
  // Someone suspended does not count as "here"; an invite not yet taken does.
  const alone = !!people && people.filter((p) => p.id !== user?.id
    && (!p.invite_status || p.invite_status === "active" || p.invite_status === "pending")).length === 0;
  if (!canAdd || hidden || !alone) return null;

  const later = () => {
    try { localStorage.setItem(LATER_KEY, String(Date.now())); } catch { /* private mode */ }
    setHidden(true);
  };

  return (
    <section
      data-testid="desk-team-nudge"
      aria-label="Bring your team in"
      className={cn("flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground", className)}
    >
      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
        <UsersThree size={18} weight="bold" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">Bring your team in</p>
        <p className="text-xs leading-snug text-muted-foreground">
          Your teams are set up. Add the people — Dex can only hand work to someone who is here.
        </p>
      </div>
      <Link
        to="/team?add=1"
        data-testid="desk-team-nudge-add"
        className="shrink-0 rounded-pill bg-kr-ink px-4 py-2 text-sm font-medium text-white"
      >
        Add people
      </Link>
      <button
        type="button"
        onClick={later}
        data-testid="desk-team-nudge-later"
        aria-label="Remind me later"
        title="Remind me in a few days"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
      >
        <X size={14} weight="bold" aria-hidden="true" />
      </button>
    </section>
  );
}
