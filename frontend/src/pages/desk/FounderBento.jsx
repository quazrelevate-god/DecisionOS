/**
 * NM-9 — the founder's one screen.
 *
 * WHAT THIS REPLACED. A "Trends" card with four rows and a "Shortcuts" card
 * with three buttons. The shortcuts duplicated the floating rail exactly, and
 * four trend rows told the founder that things had moved without telling him
 * what to do about it.
 *
 * WHAT IT IS NOW. One bento pulling the headline number from each of the four
 * working surfaces — Work, Ops, CRM, Money — sized by how much a founder has to
 * act on it, not by how important the page feels:
 *
 *   Ops score   2x2   the one number the business is graded on
 *   Work        2x1   what is late and what is due, the day's actual queue
 *   Money       2x1   overdue receivables — the cash question
 *   CRM         1x1   how many relationships are on the book
 *
 * EVERY TILE IS A VERB. Each carries a one-line "so what" and navigates to the
 * filtered view that answers it — not to the page's front door. A KPI you
 * cannot act on is a decoration, which is what the old Trends card was.
 *
 * DATA. Read from the same endpoints the four pages use, so React Query dedupes
 * with whatever the user has already visited and the numbers cannot disagree
 * with the page they link to. Every tile renders at full size while loading —
 * a dashboard whose layout reflows as data lands feels broken.
 */
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase, Gauge, AddressBook, Wallet, ArrowUpRight, Warning,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { inrCompact } from "../../lib/format";
import { cn } from "@/lib/utils";

const ymd = (d) => d.toISOString().slice(0, 10);

/** A tile that is still waiting on its number. Same footprint, no reflow. */
function TileSkeleton({ className }) {
  return (
    <div className={cn("nm-raised p-5 animate-pulse", className)}>
      <div className="h-3 w-20 rounded bg-nm-sunken" />
      <div className="mt-4 h-8 w-24 rounded bg-nm-sunken" />
      <div className="mt-3 h-3 w-32 rounded bg-nm-sunken" />
    </div>
  );
}

/**
 * @param {string}  label    the surface this came from
 * @param {node}    value    the headline number
 * @param {string}  meaning  the "so what" — one line, plain language
 * @param {string}  to       the FILTERED destination that answers it
 * @param {boolean} urgent   draws the danger accent on the value only
 */
function Tile({ icon: Icon, label, value, suffix, meaning, to, urgent, className, testid, children }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      data-testid={testid}
      className={cn(
        "nm-raised p-5 text-left group flex flex-col transition-shadow duration-150",
        "hover:shadow-nm-lg active:shadow-nm-press",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={14} weight="bold" />
        <span className="text-xs font-medium">{label}</span>
        <ArrowUpRight
          size={13}
          weight="bold"
          className="ml-auto opacity-0 transition-opacity group-hover:opacity-60"
        />
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        {/* The number stays flat and high-contrast — §0: soft depth styles the
            furniture, never the message. Only genuine urgency takes colour. */}
        <span className={cn(
          "text-3xl font-medium tabular-nums leading-none",
          urgent ? "text-danger-600" : "text-foreground"
        )}>
          {value}
        </span>
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>

      {meaning && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{meaning}</p>
      )}
      {children}
    </button>
  );
}

export function FounderBento() {
  // The four surfaces. Same keys the pages themselves use, so a founder who has
  // already opened Ops sees this tile fill instantly from cache.
  const opsQ = useQuery({
    queryKey: ["operating-score", null],
    queryFn: () => api.get("/operating-score").then((r) => r.data),
  });
  const tasksQ = useQuery({
    queryKey: ["tasks", false],
    queryFn: () => api.get("/tasks?mine=false").then((r) => r.data),
  });
  const contactsQ = useQuery({
    queryKey: ["contacts"],
    queryFn: () => api.get("/contacts").then((r) => r.data),
  });
  // The receivables figure comes from /desk/summary, NOT from the contact
  // list: /contacts carries no `outstanding` field at all, so summing it
  // returned a structural zero — this tile read "₹0 outstanding" directly
  // under a narrative saying ₹6,85,000 was overdue. Two numbers, same screen,
  // contradicting each other. The desk summary is the one the narrative
  // itself is generated from, so they cannot disagree again.
  const summaryQ = useQuery({
    queryKey: ["desk-summary"],
    queryFn: () => api.get("/desk/summary").then((r) => r.data),
  });

  const work = useMemo(() => {
    const all = Array.isArray(tasksQ.data) ? tasksQ.data : [];
    if (!all.length && tasksQ.isLoading) return null;
    const today = ymd(new Date());
    const live = all.filter((t) => t.status !== "done" && t.status !== "cancelled");
    const overdue = live.filter((t) => t.due_date && String(t.due_date).slice(0, 10) < today);
    const dueToday = live.filter((t) => t.due_date && String(t.due_date).slice(0, 10) === today);
    // Which department is carrying the lateness — the actionable part of
    // "14 delayed tasks", which the old Trends row never said.
    const byDept = {};
    overdue.forEach((t) => {
      const k = t.task_type || "other";
      byDept[k] = (byDept[k] || 0) + 1;
    });
    const worst = Object.entries(byDept).sort((a, b) => b[1] - a[1])[0];
    return { open: live.length, overdue: overdue.length, dueToday: dueToday.length, worst };
  }, [tasksQ.data, tasksQ.isLoading]);

  const ops = useMemo(() => {
    const d = opsQ.data;
    if (!d) return null;
    const score = d.company?.overall ?? null;
    const cats = d.company?.categories || {};
    // The weakest category is the lever; the score alone says nothing to pull.
    const weakest = Object.entries(cats)
      .filter(([, v]) => v != null)
      .sort((a, b) => a[1] - b[1])[0];
    return { score, weakest, enough: d.company?.enough_data !== false };
  }, [opsQ.data]);

  const crm = useMemo(() => {
    const d = contactsQ.data;
    if (!d) return null;
    const list = Array.isArray(d) ? d : d.contacts || [];
    return { total: list.length };
  }, [contactsQ.data]);

  const cash = useMemo(() => {
    const c = summaryQ.data?.trends?.cash_flow;
    if (!c) return null;
    return {
      overdue: Number(c.overdue_receivables_amount) || 0,
      unmatched: Number(c.unmatched_payments) || 0,
      clear: !!c.clear,
    };
  }, [summaryQ.data]);

  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 xl:auto-rows-[minmax(0,1fr)]"
      data-testid="desk-bento"
    >
      {/* Ops — the 2x2 anchor. The number the whole business is graded on. */}
      {!ops ? (
        <TileSkeleton className="md:col-span-2 xl:col-span-2 xl:row-span-2" />
      ) : (
        <Tile
          icon={Gauge}
          label="Operating score"
          value={ops.enough && ops.score != null ? ops.score : "—"}
          suffix={ops.enough && ops.score != null ? "/ 100" : null}
          meaning={
            !ops.enough
              ? "Not enough activity yet to grade the business."
              : ops.weakest
                ? `${ops.weakest[0][0].toUpperCase()}${ops.weakest[0].slice(1)} is the weakest at ${ops.weakest[1]} — start there.`
                : "All four areas are scoring evenly."
          }
          to="/operating-score"
          testid="bento-ops"
          className="md:col-span-2 xl:col-span-2 xl:row-span-2 justify-between"
        >
          {/* The four category bars, monochrome — the shape of the score, not
              a second palette. Reads as one instrument with the number. */}
          {ops.enough && opsQ.data?.company?.categories && (
            <div className="mt-5 space-y-2.5">
              {Object.entries(opsQ.data.company.categories).map(([k, v]) => (
                <div key={k}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs capitalize text-muted-foreground">{k}</span>
                    <span className="text-xs font-medium tabular-nums">{v ?? "—"}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-nm-sunken">
                    <div
                      className="h-full rounded-full bg-foreground/25 transition-[width] duration-700"
                      style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Tile>
      )}

      {/* Work — what is actually late, and who owns it. */}
      {!work ? (
        <TileSkeleton className="md:col-span-2" />
      ) : (
        <Tile
          icon={Briefcase}
          label="Work"
          value={work.overdue}
          suffix={work.overdue === 1 ? "late" : "late"}
          urgent={work.overdue > 0}
          meaning={
            work.overdue === 0
              ? `Nothing overdue. ${work.dueToday} due today.`
              : work.worst
                ? `Mostly ${work.worst[0]} (${work.worst[1]}). ${work.dueToday} more due today.`
                : `${work.dueToday} more due today.`
          }
          // Straight to the filtered view, not the page's front door.
          to="/my-work?filter=overdue"
          testid="bento-work"
          className="md:col-span-2"
        />
      )}

      {/* Money — what is owed TO us. The cash question a founder actually asks. */}
      {!cash ? (
        <TileSkeleton className="md:col-span-2" />
      ) : (
        <Tile
          icon={Wallet}
          label="Money"
          value={inrCompact(cash.overdue)}
          urgent={cash.overdue > 0}
          meaning={
            cash.overdue > 0
              ? `Overdue receivables.${cash.unmatched ? ` ${inrCompact(cash.unmatched)} unmatched.` : ""} Chase before month end.`
              : "Cash-flow is clear — nothing overdue."
          }
          to="/finance?tab=revenue"
          testid="bento-money"
          className="md:col-span-2"
        />
      )}

      {/* CRM — the relationship count, the smallest cell. */}
      {!crm ? (
        <TileSkeleton />
      ) : (
        <Tile
          icon={AddressBook}
          label="Relationships"
          value={crm.total}
          meaning="Buyers and suppliers on the book."
          to="/crm"
          testid="bento-crm"
        />
      )}

      {/* Attention — only appears when something genuinely needs him. An empty
          alert slot every day trains a founder to ignore the row. */}
      {work && work.overdue > 0 && (
        <Tile
          icon={Warning}
          label="Needs you"
          value={work.overdue}
          suffix={work.overdue === 1 ? "item" : "items"}
          urgent
          meaning="Late work waiting on a decision or a chase."
          to="/my-work?filter=overdue"
          testid="bento-attention"
        />
      )}
    </div>
  );
}

export default FounderBento;
