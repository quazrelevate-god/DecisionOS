// /inbox — the founder's dashboard, KR-8: the Health Karma reference,
// replicated on real data.
//
// LAYOUT (ASK-25 · the Decision Desk redesign, 2026-09-13):
//   light zone · LEFT   the two-line greeting, the Company/You slider, the
//                       score numeral with the ArcGauge beside it, and the
//                       Dex well on the column's floor — ASK-33: the Decide
//                       door, where a decision is spoken or typed
//   light zone · RIGHT  the 3×2 StatTile grid, one glass tile among five
//   THE DESK           three frost columns on the same ground, no dark band:
//                       Decisions (on the well's own column) | Task approvals
//                       | Due today / Leave / Slipping stacked. Colour lives
//                       in each card's title, dot and action pill only. Every
//                       row opens its own page; nothing is approved inline —
//                       rejecting a decision deletes the tasks it created and
//                       belongs on /decisions/:id, and task approvals have a
//                       page of their own (/approvals, ASK-25 F3).
//
// WHAT DIED HERE: the dark band and DecisionBento (KR-8.5 → KM-38), the
// fixed bottom sheet below lg (KM-33) and its spacer, the "Important" chip
// (its feed always came back empty), the Leave Approvals cards under the
// bento (ASK-7 — they moved to /approvals), and the chase/nudge buttons on
// the cards (the row is the button now).
//
// Deep-link contract preserved: /inbox?decision=<id> redirects to the
// decision page (KM-28).
import { useState, useEffect, useRef, useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { inrCompact } from "../lib/format";
import { selfScore } from "../lib/karmaScore";
import { isDemoTenant, demoDelta } from "./_operatingScoreDemo";
import {
  ArcGauge, StatTile, ScopeSlider,
  BigNumeral, KDeltaChip, MiniBars, CircleDots, TinySpark,
} from "../components/karma";
import { useDeskMetrics } from "./desk/useDeskMetrics";
// ASK-33 — the well on the left column's floor is Dex's Decide door. It owns
// the capture hooks and hosts the repurposed InsightWell container itself.
import { DeskDexWell } from "./desk/DeskDexWell";
// 2026-09-14, founder — the Task approvals column opens My Work's task
// drawer HERE, on the Desk, instead of sending the founder to My Work.
import { TaskCard } from "./MyWork";
// 2026-09-14, founder — a decision opens as a POPUP here too, on the glass,
// at 70% of the screen, instead of leaving for /decisions/:id.
import { DecisionDialog } from "../components/DecisionDialog";
// ASK-33 — "today's read" is retired from the Desk. Its call site below is
// commented out, not deleted, and lib/deskInsight.js — the ranker — is kept,
// untouched, for possible reuse.
// import { deskInsight } from "../lib/deskInsight";
import {
  ArrowSquareOut, CaretRight, Timer, Check, X,
  ChatCircleText, Gauge as GaugeIcon, Receipt, HandCoins, TrendUp,
} from "@phosphor-icons/react";

// ASK-34 7.3 — the undo window on a reject. Long enough to notice the toast
// and reach it, short enough that the row leaving the column is believable.
const UNDO_MS = 6000;

// ASK-25 — the three chips the Desk still asks /desk for. `important` is
// gone: its builder returns an empty list (see _cards_important) so the box
// could never show anything. Order is the reading order across the page:
// Decisions on the left, then the two task feeds in the right-hand stack.
const SECTIONS = [
  { key: "needs_decision", empty: "No decisions waiting on you" },
  { key: "on_fire",        empty: "Nothing slipping" },
  { key: "due_today",      empty: "Nothing due today" },
];

/* ASK-25 — the section identities. `tone` is the class that carries the
   two-tone hue variables (.kr-desk--* and .kr-glass--warm in index.css).
   2026-09-14, founder — the board is ONE BLACK CONTAINER now, not three
   frost cards ("instead of glass or frost glass we go with the black
   container, print the text on the container itself in white font, use
   lines for horizontal and vertical separator; for the three rows we can
   use white cards"). So on the black the title is white and only the dot
   and the action pill carry the hue; on the white stack cards the title
   prints the hue's deep end as before. */
const TONE = {
  needs: "kr-desk--needs",
  flag:  "kr-desk--flag",
  today: "kr-desk--today",
  fire:  "kr-desk--fire",
  warm:  "kr-glass--warm",
};

const daysSince = (iso) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : null;
};
const daysLabel = (n) => (n == null ? "" : n === 0 ? "today" : `${n} day${n === 1 ? "" : "s"}`);

/* ASK-25 — the leave chip's one line: the PEOPLE waiting, first names,
   each once (five requests from one person is one name, not five), then
   the first request's dates in the tail. */
const leaveNames = (leaves) => {
  const names = [...new Set(leaves.map((l) => (l.user_name || "").split(" ")[0]).filter(Boolean))];
  return names.length ? `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}` : "";
};
const shortDay = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
const leaveRange = (lv) =>
  !lv.from_date ? "" : lv.to_date && lv.to_date !== lv.from_date ? `${shortDay(lv.from_date)}–${shortDay(lv.to_date)}` : shortDay(lv.from_date);

/* ASK-25 — the Company/You control is the kit's ScopeSlider (a pressed
   track with a raised thumb that slides to the chosen half). Company leads,
   per the founder's reference. */
const SCOPE_OPTIONS = [{ key: "company", label: "Company" }, { key: "you", label: "You" }];

/* ASK-25 — the row's one action: open the thing. A raised .kr-pop circle
   with the open-in-page glyph; the whole row is also the link, the circle
   is where the eye lands. */
function OpenButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title="Open"
      /* On the black board: a white-glass circle, no blur (nothing behind it
         to blur), lit a step on hover. */
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.10] text-white/80 transition-colors hover:bg-white/[.20] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      <ArrowSquareOut size={14} weight="bold" aria-hidden="true" />
    </button>
  );
}

/* ASK-34 7.3 — APPROVE AND REJECT, ON THE ROW. Desktop only: `hidden lg:grid`
   is the whole of "do not touch these columns below lg".
   Circular, like the open button beside them, and 44px rather than its 32 —
   these two commit something. stopPropagation on BOTH click and keydown: the
   row is a role="link" with its own Enter handler, so without the second one a
   keyboard Approve would also open the decision it just approved. */
function RowAction({ intent, label, onClick }) {
  const Glyph = intent === "approve" ? Check : X;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      data-testid={`desk-row-${intent}`}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
        intent === "approve"
          ? "bg-emerald-400/15 text-emerald-300 hover:bg-emerald-400/25 hover:text-emerald-200"
          : "bg-rose-400/15 text-rose-300 hover:bg-rose-400/25 hover:text-rose-200"
      }`}
    >
      <Glyph size={16} weight="bold" aria-hidden="true" />
    </button>
  );
}

/** The pair, 8px apart (spacing.touch-gap), desktop only. */
function RowActions({ what, onApprove, onReject }) {
  return (
    <span className="hidden items-center gap-touch-gap lg:flex">
      <RowAction intent="approve" label={`Approve: ${what}`} onClick={onApprove} />
      <RowAction intent="reject" label={`Reject: ${what}`} onClick={onReject} />
    </span>
  );
}

function CountPill({ n, onInk = false }) {
  return (
    <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold tabular-nums ${onInk ? "bg-white/[.10] text-white/80" : "bg-kr-ink/[.08]"}`}>
      {n ?? "—"}
    </span>
  );
}

/** The column's heading: dot · title · count · note, printed flat on the
 *  board with a hairline under it (2026-09-14, founder — the Chrome-tab
 *  treatment tried before it is gone: "remove the chrome header style to
 *  flat line"). */
function DeskHeading({ tone, title, count, note, className = "" }) {
  return (
    <div className={`${TONE[tone]} flex min-w-0 items-center gap-2.5 border-b border-white/[.14] pb-2.5 ${className}`}>
      <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-[hsl(var(--kr-glass-from))]" />
      {/* 2026-09-14, founder — "white is too bright": medium weight and
          white at 85%, never full white, everywhere on the board. */}
      <h3 className="text-base font-medium tracking-[-0.006em] text-white/85">{title}</h3>
      <CountPill n={count} onInk />
      {note && <span className="ml-0.5 hidden truncate text-xs text-white/50 xl:inline">{note}</span>}
    </div>
  );
}

/**
 * A list COLUMN on the black board: as many rows as fit, and a floor with
 * the overflow note on the left and the section-hued action pill on the
 * right. GREY type on the container itself (2026-09-14, founder: "use grey
 * color for the contents" — neutral-300 for what matters, neutral-500 for
 * the rest; only the headings keep their white); rows are parted by
 * hairlines, not boxed, and the heading sits flat at the top of the column
 * over a hairline of its own.
 * @param {Array<{id, title, meta, amount?, onOpen}>} rows
 */
function DeskCard({ tone, title, count, note, rows, loading, empty, moreSuffix = "", cta, onCta, scroll = false, testid, className = "" }) {
  /* ASK-25 — AS MANY ROWS AS THE CARD HOLDS, measured, not typed. On desktop
     the card's height is whatever the viewport leaves under the hero, so a
     fixed four rows left a hole on any screen taller than the mock's
     minimum (the founder: "still more space, can add data's right?"). A
     ResizeObserver on the list reads its real height, divides by a real
     row, and the card shows that many — more on a tall screen, fewer on a
     short one, never a clipped half-row. Below lg the card is not
     height-constrained, so the list is exactly as tall as what it shows and
     the measurement returns the count it started with: four. */
  const listRef = useRef(null);
  const [fit, setFit] = useState(4);
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      /* ASK-32 — below lg the card is NOT height-constrained, so measuring it
         only ever returned the rows already drawn: a list that first loaded
         with one row stayed at one row, and "That's all of them" sat under a
         column holding three. On a phone every row is shown (the caller
         already caps the list). */
      if (typeof window !== "undefined" && window.matchMedia && !window.matchMedia("(min-width: 1024px)").matches) {
        /* ASK-34 7.2 — the callers no longer slice to 12 before handing the
           rows over, because on DESKTOP the column now shows every one of
           them. The phone keeps the twelve it has always had, and its overflow
           note keeps counting the same way, so nothing below lg changes. */
        setFit(Math.max(1, scroll ? Math.min(rows.length, 12) : rows.length));
        return;
      }
      /* ASK-34 7.2 — THE WHOLE LIST, and the COLUMN is what scrolls. The
         measured fit exists because the card could not grow; that is still
         true — the black board keeps exactly the height the page gives it and
         never scrolls itself. What changes is that the rows below the fold are
         reachable inside the column instead of being cut off at it. */
      if (scroll) { setFit(rows.length); return; }
      const rs = el.querySelectorAll("[data-row]");
      let rowH = 0;
      /* offsetHeight, not getBoundingClientRect: under the page's CSS zoom
         (UI-SCALE) a rect is reported in visual px while clientHeight below
         is in the element's own px, and dividing one by the other under-
         filled the card by the zoom factor. Both offset* and client* are
         local, so the ratio holds at every scale. */
      rs.forEach((r) => { rowH = Math.max(rowH, r.offsetHeight); });
      if (!rowH) return;
      setFit(Math.max(1, Math.floor(el.clientHeight / rowH)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [rows.length, scroll]);
  const shown = rows.slice(0, fit);
  /* ASK-32 2.4 — the Decisions count is what waits on ME, but the column also
     lists what I raised for someone else, so the overflow note counts the rows
     themselves when there are more of those than the count. */
  const remaining = Math.max(0, Math.max(count ?? 0, rows.length) - shown.length);
  const more = loading ? "" : remaining > 0 ? `${remaining} more${moreSuffix}` : rows.length > 0 ? "That's all of them" : "";

  return (
    <div className={`min-w-0 lg:min-h-0 ${className}`} data-testid={testid}>
      <div className={`${TONE[tone]} flex h-full min-h-0 flex-col gap-1`}>
        <DeskHeading tone={tone} title={title} count={count} note={note} className="shrink-0" />

        <div
          ref={listRef}
          /* The scroll lives HERE, inside the column, so the board's own box
             is untouched: it does not grow and it does not scroll. A thin
             scrollbar, because the track is 1px of grey on near-black and a
             10px one reads as a second vertical rule beside the real ones. */
          className={`min-h-0 flex-1 overflow-hidden ${scroll ? "lg:overflow-y-auto lg:pr-1 lg:[scrollbar-width:thin]" : ""}`}
        >
          {loading && (
            <div className="space-y-2 pt-2" aria-hidden="true">
              <div className="ds-skeleton h-5 w-4/5 rounded-control" />
              <div className="ds-skeleton h-5 w-3/5 rounded-control" />
            </div>
          )}
          {!loading && rows.length === 0 && (
            <p className="py-3 text-sm text-neutral-500" data-testid={`${testid}-empty`}>{empty}</p>
          )}
          {!loading && shown.map((r, i) => (
            <div
              key={r.id}
              data-row=""
              role="link"
              tabIndex={0}
              onClick={r.onOpen}
              onKeyDown={(e) => { if (e.key === "Enter") r.onOpen(); }}
              data-testid={`${testid}-row-${r.id}`}
              className={`flex cursor-pointer items-center justify-between gap-3 py-[7px] ${i > 0 ? "border-t border-white/[.14]" : ""}`}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-[15px] font-medium leading-5 tracking-[-0.006em] text-neutral-300">{r.title}</p>
                {r.meta && <p className="truncate text-xs leading-4 text-neutral-500">{r.meta}</p>}
              </div>
              {/* ASK-34 7.3 — the amount, then the two actions, then the open
                  icon, all in one row with a 10px trough between them (the two
                  actions are 8px apart inside their own span). The row itself
                  stays the link; the buttons only stop their own click. */}
              <span className="flex shrink-0 items-center gap-2.5">
                {r.amount && <span className="font-mono text-[13px] leading-5 text-neutral-400">{r.amount}</span>}
                {r.actions}
                <OpenButton onClick={(e) => { e.stopPropagation(); r.onOpen(); }} label={`Open: ${r.title}`} />
              </span>
            </div>
          ))}
        </div>

        {/* ASK-34 7.1 / 7.2 — GONE ON DESKTOP, both halves of it.
            "Review" opened decisionCards[0] and "Approvals" left for My Work;
            the first is exactly what its own row already does (ASK-25: "the
            row is the button now"), so it was a second button for the same
            tap. And with every row visible and scrollable, "31 more waiting"
            and "That's all of them" are both false — the count in the heading
            is the true one and it is already there.
            Below lg the column still shows twelve and still cannot scroll, so
            the note and the pill are still the only way to the rest: the
            phone's version of this column is a separate conversation. */}
        <div className={`mt-auto flex shrink-0 items-end justify-between gap-3 pt-2 ${scroll ? "lg:hidden" : ""}`}>
          <p className="min-w-0 flex-1 truncate text-xs text-neutral-500">{more}</p>
          {cta && (
            <button
              type="button"
              onClick={onCta}
              data-testid={`${testid}-cta`}
              /* ASK-25 — MATTE. The section's bright hue as a flat fill: no
                 lip, no glow, no shadow (the founder: "no glow just matte"). */
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-pill bg-[hsl(var(--kr-glass-from))] px-4 text-xs font-semibold text-[hsl(var(--kr-glass-btn-fg,0_0%_100%))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {cta}
              <CaretRight size={11} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** One of the three stacked cards, on the black board: dot · title · count
 *  on one line, one line of content, and a single centred chevron — the card
 *  is the link.
 *  2026-09-14, founder — "use the card color in the image": the old dark
 *  band's cards, i.e. .kr-glass in the section's hue at the .10/.05 tint the
 *  .kr-desk--* variants dial it to, with the recipe's own white hairline. The
 *  tone class sits on the card itself so the glass reads its hue. */
function StackCard({ tone, title, count, line, tail, loading, empty, to, testid }) {
  return (
    <Link
      to={to}
      data-testid={testid}
      className={`kr-glass kr-lift ${TONE[tone]} flex min-h-0 flex-1 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70`}
    >
      <div className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-[hsl(var(--kr-glass-from))]" />
            <h3 className="text-base font-medium tracking-[-0.006em] text-white/85">{title}</h3>
            <CountPill n={count} onInk />
          </div>
          {loading
            ? <div className="ds-skeleton h-4 w-2/3 rounded-control" aria-hidden="true" />
            : <p className="truncate text-sm text-neutral-300">
                {line
                  ? <>{line}{tail && <span className="text-neutral-500"> &middot; {tail}</span>}</>
                  : <span className="text-neutral-500">{empty}</span>}
              </p>}
        </div>
        <CaretRight size={22} weight="bold" aria-hidden="true" className="kr-arrow shrink-0 text-white/50 transition-transform duration-200" />
      </div>
    </Link>
  );
}

export default function Desk() {
  const navigate = useNavigate();
  const { user, tenant } = useAuth();
  const m = useDeskMetrics();
  const heroRef = useRef(null);
  // ASK-33 Phase 2 — the expanded Dex well grows to this grid's top, and while
  // it is the workspace the greeting and the score row above it fade.
  const kpiGridRef = useRef(null);
  const [dexExpanded, setDexExpanded] = useState(false);

  // Owner sees Company/You; everyone else only ever has their own view.
  const [scope, setScope] = useState("company");

  // E2-66: deep-link from a decision-focused nudge notification.
  const [searchParams] = useSearchParams();
  const focusDecisionId = searchParams.get("decision");
  // KM-28 — ?decision=<id> redirects to the page rather than raising the
  // modal behind the Desk, so a notification and a tap land in the same place.
  // ?decision=<id> (notifications, pasted links) opens the same popup over
  // the Desk; closing it drops the parameter so the Desk is plain again.
  const [openDecisionId, setOpenDecisionId] = useState(null);
  useEffect(() => { if (focusDecisionId) setOpenDecisionId(focusDecisionId); }, [focusDecisionId]);
  const closeDecision = () => {
    setOpenDecisionId(null);
    if (focusDecisionId) navigate("/inbox", { replace: true });
  };

  // The board fetch — the three chips in parallel, cache-shared, 30s fresh.
  const boardQs = useQueries({
    queries: SECTIONS.map((c) => ({
      queryKey: ["desk", c.key],
      queryFn: () => api.get(`/desk?chip=${c.key}`).then((r) => r.data),
      refetchInterval: 30000,
    })),
  });
  const counters = boardQs.find((q) => q.data?.counters)?.data?.counters || null;
  const cardsOf = (i) => boardQs[i]?.data?.cards || [];
  const [decisionCards, fireCards, todayCards] = [cardsOf(0), cardsOf(1), cardsOf(2)];

  // ASK-25 · Task approvals: every task waiting for sign-off that THIS person
  // may approve. ASK-28 TK-02 — read from GET /tasks?view=approvals, which the
  // server limits with tasks.py's _can_approve_task rule. The metrics hook's
  // /tasks (mine=false) is a non-owner's own lane only, so a named approver
  // outside it saw 0 here. Same query key as My Work's Approvals view, so the
  // count and the list never disagree; the client check stays as a guard.
  const canApproveTask = (t) =>
    user?.role === "owner" || (![t.assignee_id, t.created_by, ...(t.co_assignee_ids || [])].includes(user?.id)
      && (t.approver_id ? (user?.id === t.approver_id || (user?._acting_for || []).includes(t.approver_id))
        : hasPerm(user, "approvals")));
  const approvalsQ = useQuery({
    queryKey: ["tasks", "approvals"],
    queryFn: () => api.get("/tasks?view=approvals").then((r) => r.data),
    refetchInterval: 60000,
  });
  const approvals = useMemo(
    () => (approvalsQ.data || []).filter((t) =>
      t.approval_required && t.approval_status === "pending"
      && t.status !== "done" && t.status !== "cancelled" && canApproveTask(t))
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))),
    [approvalsQ.data, user] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const showApprovals = user?.role === "owner" || hasPerm(user, "approvals") || approvals.length > 0;
  /* 2026-09-14, founder — "if I click the open icon for the approvals, open
     the drawer in the Decision Desk itself, don't go to My Work". The row
     opens TaskCard's drawer (drawerOnly) over this page; the people list and
     the role options the drawer's Reassign needs are fetched only once a
     drawer is open. Any change the drawer makes refreshes the approvals
     feed and the task list the KPI tiles read, so the row leaves the column
     the moment it is signed off. */
  const qc = useQueryClient();
  const [openTaskId, setOpenTaskId] = useState(null);
  const openTask = openTaskId ? (approvalsQ.data || []).find((t) => t.id === openTaskId) : null;
  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
    enabled: !!openTaskId,
  });
  const roleOptions = useMemo(() => [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])], [tenant?.roles]);
  const refreshTasks = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["desk-summary"] });
  };

  /* ASK-34 7.3 — DECIDING FROM THE ROW, AND TAKING A REJECT BACK.
     Read the header of this file first: ASK-25 kept approve and reject OFF the
     Desk on purpose, because rejecting a decision throws away the work it
     proposed and that deserved the full page. What changes that is not a
     smaller conscience, it is an undo: a confirm dialog would cost a tap on
     every single rejection including the ones the founder is sure about, which
     is the exact thing the shortcut exists to remove, so instead NOTHING
     REACHES THE SERVER until the window closes. The row leaves the column at
     once because that is the honest picture of what is about to happen; Undo
     puts it back and no request is ever made.
     `retiring` is what a row that has left looks like while the window runs —
     the 30s board poll keeps returning it until the commit lands, so without
     this it would flick straight back in. */
  const [retiring, setRetiring] = useState(() => new Set());
  const retire = (id) => setRetiring((s) => new Set(s).add(id));
  const restore = (id) => setRetiring((s) => { const n = new Set(s); n.delete(id); return n; });
  const refreshBoard = () => {
    ["desk", "decisions", "tasks", "desk-summary", "notifications"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }));
  };
  const failed = (e, fallback) => toast.error(e?.response?.data?.detail || fallback);

  // Approve CREATES work rather than cancelling it — there is nothing to take
  // back, so it goes straight out and says so.
  const approveRow = async (id, run, said) => {
    retire(id);
    try { await run(); toast.success(said); refreshBoard(); }
    catch (e) { restore(id); failed(e, "Could not approve it"); }
  };
  const rejectRow = (id, run, said) => {
    retire(id);
    let undone = false;
    const timer = setTimeout(async () => {
      if (undone) return;
      try { await run(); refreshBoard(); }
      catch (e) { restore(id); failed(e, "Could not reject it"); }
    }, UNDO_MS);
    toast(said, {
      duration: UNDO_MS,
      action: { label: "Undo", onClick: () => { undone = true; clearTimeout(timer); restore(id); } },
    });
  };

  // ASK-25 · Leave: the chip on the Desk, the cards on /approvals.
  const canApproveLeave = user?.role === "owner" || hasPerm(user, "leave_approve");
  const leavesQ = useQuery({
    queryKey: ["leaves", "approvals"],
    queryFn: () => api.get("/leaves?scope=approvals").then((r) => r.data),
    enabled: !!canApproveLeave,
  });
  const pendingLeaves = (leavesQ.data || []).filter((l) => l.status === "pending" || l.status === "info_requested");

  // ── the score block ──────────────────────────────────────────────────────
  const ops = m.ops;
  const isOwnerView = ops?.view === "owner";
  const youScore = isOwnerView ? selfScore(ops.mySnapshot) : selfScore(ops?.stats);
  const shownScore =
    !ops ? null
    : isOwnerView
      ? (scope === "you" ? youScore : (ops.enough ? ops.score : null))
      : youScore;
  const scoreReady = shownScore != null;

  // ASK-33 — RETIRED CALL SITE. The well no longer prints Dex's read of the
  // day; it takes decisions (pages/desk/DeskDexWell). Kept here, commented,
  // with lib/deskInsight.js untouched, in case the ranker finds another home.
  //
  // KR-8.7 — Dex's lead for the well. A ranker over metrics the page has
  // already fetched, so it adds a request count of zero and cannot contradict
  // a tile. ASK-25 — the well shows the HEADLINE only: the supporting lines
  // restated the tiles beside it (KM-1 made that case on the phone), and the
  // height they cost is what the Desk below needed.
  // const insightFull = deskInsight(m, isOwnerView ? (counters?.needs_decision ?? 0) : 0);
  // const insight = insightFull ? { ...insightFull, lines: [] } : null;

  const greeting = m.greeting;
  const gi = greeting.lastIndexOf(",");

  // Decisions are the owner's box, and anyone else's only when the backend
  // has routed one to them (it scopes by approver_id).
  const showDecisions = isOwnerView || decisionCards.length > 0;
  const decisionsLoading = boardQs[0]?.isLoading;
  const topDecision = decisionCards[0];
  /* ASK-34 7.3 — a row that has been acted on is out of the column and out of
     the count from the moment it is tapped; the refetch after the commit makes
     it true. An Undo puts both back. */
  const liveDecisions = decisionCards.filter((c) => !retiring.has(c.id));
  const decisionCount = counters
    ? Math.max(0, counters.needs_decision - decisionCards.filter((c) => retiring.has(c.id)).length)
    : null;
  const liveApprovals = approvals.filter((t) => !retiring.has(t.id));

  return (
    /* ASK-25 — ONE SCREEN. On desktop the page is a flex column that fills
       the frame Layout hands it (lg:h-full on the content wrapper): the hero
       takes its natural height and the desk below takes the rest, so the
       whole Desk sits inside the viewport and nothing scrolls. Below lg the
       same tree simply stacks and the phone scrolls. */
    <div data-testid="desk-page" className="flex flex-col gap-6 lg:min-h-0 lg:flex-1">
      {/* ── LIGHT ZONE ───────────────────────────────────────────────── */}
      {/* KR-8.6 — the split and the gaps are MEASURED off the reference:
          36 / 56 with a wide 8% trough between. */}
      <div ref={heroRef} className="kr-hero flex flex-col gap-6 lg:grid lg:shrink-0 lg:grid-cols-[minmax(0,29fr)_minmax(0,45fr)] lg:gap-20">
        {/* LEFT column — greeting, the score row, the well on the floor.
            KR-14.2 · MOBILE — display:contents so its children flow into
            the outer column and the KPI strip can slot between them. */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3">
          {/* Greeting on the LEFT, compact score+gauge on the RIGHT on the
              phone; on lg the greeting stands alone, two lines, the name
              carrying the weight (the founder's reference). */}
          <div className="kr-dex-fade order-1 flex items-start justify-between gap-4 lg:order-none lg:block" data-dex-faded={dexExpanded ? "true" : "false"}>
            <h1 className="font-display text-2xl leading-tight lg:text-[34px] lg:font-light lg:leading-[1.15]" data-testid="desk-brief-greeting">
              {gi === -1
                ? <span>{greeting || " "}</span>
                : <>
                    <span className="lg:block">{greeting.slice(0, gi + 1)}</span>
                    <span className="text-muted-foreground lg:block lg:text-5xl lg:font-bold lg:leading-[1.08] lg:tracking-[-0.02em] lg:text-foreground">{greeting.slice(gi + 1)}.</span>
                  </>}
            </h1>

            {/* Compact score cluster — mobile only. */}
            <div className="flex shrink-0 items-center gap-3 lg:hidden" aria-hidden={!scoreReady}>
              <div className="flex items-baseline">
                <span className="font-display text-6xl leading-none">{scoreReady ? shownScore : "—"}</span>
                {scoreReady && <span className="ml-1 text-sm text-muted-foreground">/100</span>}
              </div>
              <ArcGauge value={scoreReady ? shownScore : null} size={110} className="w-24 shrink-0 text-foreground" />
            </div>
          </div>

          {/* ASK-25 · the score row, desktop: slider over the numeral on the
              left, the gauge to the right on the same floor. items-end lands
              the gauge's diameter on the numeral's baseline (KR-8.8). */}
          <div className="kr-dex-fade hidden lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end lg:gap-5" data-dex-faded={dexExpanded ? "true" : "false"}>
            <div className="flex flex-col items-start gap-2.5">
              {isOwnerView && (
                <ScopeSlider options={SCOPE_OPTIONS} value={scope} onChange={setScope} label="Score scope" testid="desk-scope" />
              )}
              {/* Delta eyebrow — demo-tenant only; no endpoint carries a real
                  score delta yet (see _operatingScoreDemo's wire-order note). */}
              {isDemoTenant(tenant) && scoreReady && (
                <p data-testid="desk-score-delta">
                  <KDeltaChip
                    pct={demoDelta.sign === "down" ? -demoDelta.value : demoDelta.value}
                    direction={demoDelta.sign}
                    downIsBad
                    suffix=" pts"
                  />
                </p>
              )}
              <div className="flex items-baseline gap-2.5">
                <BigNumeral
                  text={scoreReady ? String(shownScore) : "—"}
                  size="hero"
                  countUp={scoreReady}
                  testid="desk-score"
                />
                {scoreReady && <span className="text-2xl text-muted-foreground">/ 100</span>}
              </div>
              {/* KR-8.8 — the caption survives ONLY in the not-enough-data
                  case, where a bare "—" would be a shrug. */}
              {!scoreReady && (
                <p className="text-sm leading-snug text-muted-foreground" data-testid="desk-score-caption">
                  Score kicks in soon —<br />a little real activity first
                </p>
              )}
            </div>
            <ArcGauge
              value={scoreReady ? shownScore : null}
              size={206}
              className="w-[206px] shrink-0 justify-self-end text-foreground"
              testid="desk-gauge"
            />
          </div>

          {/* KM-1 — order-4 puts the well AFTER the KPI grid on a phone.
              ASK-25 — on lg it takes the column's remaining height, so its
              floor and the tile grid's floor are the same line.
              ASK-33 — the same box, classes and testid; what it holds is
              Dex's Decide composer instead of today's read. */}
          <DeskDexWell
            className="order-4 min-h-[150px] lg:order-none lg:min-h-0 lg:flex-1"
            testid="desk-insight"
            growToRef={kpiGridRef}
            onExpandedChange={setDexExpanded}
            onReview={(id) => setOpenDecisionId(id)}
          />
        </div>

        {/* KR-14.20 · MOBILE — the KPIs are four rounded rectangles in a
            2×2 grid. Each card: label on the LEFT, icon + numeral aligned
            to the RIGHT. Score-mix and Spend are dropped per the founder;
            the four kept are Delayed, Complaints, Overdue, Net profit. */}
        <div className="order-3 grid grid-cols-2 gap-2 lg:hidden" data-testid="desk-kpi-strip">
          {[
            { icon: Timer, label: "Delayed",
              value: String(m.counters ? m.counters.delayed : m.work?.overdue ?? "…"),
              urgent: (m.counters?.delayed ?? m.work?.overdue ?? 0) > 0,
              to: "/my-work?filter=overdue", testid: "kpi-delayed-m" },
            { icon: ChatCircleText, label: "Complaints",
              value: String(m.complaints ? m.complaints.value : "…"),
              urgent: (m.complaints?.new_7d || 0) > 0,
              to: "/crm", testid: "kpi-complaints-m" },
            { icon: HandCoins, label: "Overdue",
              value: m.cash ? inrCompact(m.cash.overdue) : "…",
              urgent: (m.cash?.overdue || 0) > 0,
              to: "/finance?tab=revenue&filter=overdue", testid: "kpi-collect-m" },
            { icon: TrendUp, label: "Net profit",
              value: m.ledger && Number.isFinite(m.ledger.netProfit) ? inrCompact(m.ledger.netProfit) : "…",
              urgent: m.ledger ? m.ledger.netProfit < 0 : false,
              to: "/finance", testid: "kpi-profit-m" },
          ].map((k) => (
            <Link key={k.testid} to={k.to} data-testid={k.testid}
              className="flex min-w-0 items-center justify-between gap-2 rounded-[1.1rem] bg-white/75 p-3 ring-1 ring-inset ring-white/80 shadow-[0_8px_22px_-14px_hsl(150_15%_20%/0.3)] backdrop-blur-xl">
              <p className="min-w-0 truncate text-xs font-medium text-foreground/80">{k.label}</p>
              <span className="flex shrink-0 items-center gap-1.5">
                <k.icon size={13} weight="regular" aria-hidden="true" className="text-muted-foreground" />
                <span className={`font-display text-base leading-none tabular-nums ${k.urgent ? "text-kr-accent" : ""}`}>
                  {k.value}
                </span>
              </span>
            </Link>
          ))}
        </div>

        {/* RIGHT — the 3×2 grid. Six honest tiles; Score mix is the glass one.
            KR-8.6 · 3 columns from lg, 12px gutters, auto-rows-fr so the two
            rows are EQUAL and the grid's floor lands on the well's floor.
            ASK-25 — the rows are shorter than they were because the LEFT
            column got shorter (the numeral, the gauge and the well all took a
            step down); the tiles follow, they are not sized on their own. */}
        <div ref={kpiGridRef} className="order-3 hidden min-w-0 grid-cols-2 gap-3 lg:order-none lg:grid lg:auto-rows-fr lg:grid-cols-3" data-testid="desk-kpi-grid">
          <StatTile
            icon={Timer}
            label="Delayed"
            value={String(m.counters ? m.counters.delayed : m.work?.overdue ?? "…")}
            urgent={(m.counters?.delayed ?? m.work?.overdue ?? 0) > 0}
            alert={(m.counters?.delayed ?? 0) > 0}
            viz={m.work?.deptCounts?.length ? <MiniBars values={m.work.deptCounts} accentIndex={0} width={64} /> : null}
            to="/my-work?filter=overdue"
            countUp
            testid="kpi-delayed"
          />
          <StatTile
            icon={ChatCircleText}
            label="Complaints"
            value={String(m.complaints ? m.complaints.value : "…")}
            urgent={(m.complaints?.new_7d || 0) > 0}
            alert={m.complaints?.new_7d > 0 ? m.complaints.new_7d : false}
            viz={m.complaints ? <CircleDots count={m.complaints.new_7d} /> : null}
            meaning={m.complaints?.new_7d > 0 ? `${m.complaints.new_7d} new this week` : undefined}
            to="/crm"
            countUp
            testid="kpi-complaints"
          />
          <StatTile
            glass
            icon={GaugeIcon}
            label={isOwnerView && ops.weakest ? `Weakest — ${ops.weakest[0]}` : "Score mix"}
            value={isOwnerView && ops.weakest ? String(ops.weakest[1]) : "—"}
            viz={isOwnerView ? <MiniBars values={ops.catValues} width={64} /> : null}
            to="/operating-score"
            testid="kpi-score-mix"
          />
          <StatTile
            icon={HandCoins}
            alert={(m.cash?.overdue || 0) > 0}
            label="To collect (overdue)"
            value={m.cash ? inrCompact(m.cash.overdue) : "…"}
            urgent={(m.cash?.overdue || 0) > 0}
            to="/finance?tab=revenue&filter=overdue"
            testid="kpi-collect"
          />
          <StatTile
            icon={TrendUp}
            label="Net profit"
            value={m.ledger && Number.isFinite(m.ledger.netProfit) ? inrCompact(m.ledger.netProfit) : "…"}
            urgent={m.ledger ? m.ledger.netProfit < 0 : false}
            to="/finance"
            testid="kpi-profit"
          />
          <StatTile
            icon={Receipt}
            label="Spend, this month"
            value={m.ledger?.lastMonthSpend != null ? inrCompact(m.ledger.lastMonthSpend) : "…"}
            viz={m.ledger?.byMonth?.length > 1
              ? <TinySpark points={m.ledger.byMonth.map((x) => x.amount)} tone="neutral" />
              : null}
            to="/finance"
            testid="kpi-spend"
          />
        </div>
      </div>

      {/* ── THE DESK ─────────────────────────────────────────────────── */}
      {/* ASK-25 — Decisions sits on the WELL'S column: its track is the
          hero's left column re-derived — (100% − the 80px trough) × 29/74 —
          so the two edges line up to the pixel whatever the width, while the
          trough between Decisions and Approvals is the tighter 32px the
          founder asked for. The right column splits 1.35 : 1 between Task
          approvals and the stack. Below lg everything is one column. */}
      {/* 2026-09-14, founder — ONE BLACK CONTAINER. The three columns sit on
          the ink and are parted by 1px white hairlines (vertical between the
          columns, horizontal between the rows) rather than boxed in frost;
          only the three-row stack keeps cards, in the old band's dark glass.
          The column formula is unchanged — Decisions still takes the well's
          share — but the 32px trough is now padding either side of the
          rule instead of a grid gap, so the line sits centred in it.
          lg:-mb-8 + square bottom corners: the black runs to the viewport's
          floor through the content wrapper's 2rem bottom padding (Layout's
          lg:p-8) — the founder: "there is a gap in the bottom, fill it with
          black". The board's own bottom padding keeps the rows off the edge.

          The headings sit flat at the top of their columns, over a
          hairline. */}
      <section
        aria-label="Decision desk"
        data-testid="desk-board"
        /* ASK-34 7.2 — `lg:grid-rows-[minmax(0,1fr)]` is what keeps the board
           the size the page gave it. A grid's auto row is stretched by free
           space but is never SHRUNK below its content, so the moment a column
           held every row instead of the few that fit, the row grew to 530px
           inside a 388px board and the columns spilled out the bottom of the
           black. minmax(0,1fr) makes the row take the container's height and
           allows it to go under its content — which is precisely what lets the
           overflow land on the list inside, where the scroll now is. */
        className={`kr-desk-board grid gap-5 lg:-mb-8 lg:min-h-0 lg:flex-1 lg:gap-0 lg:grid-rows-[minmax(0,1fr)] ${showDecisions ? "lg:grid-cols-[calc((100%-5rem)*29/74+2.5rem)_minmax(0,1fr)]" : ""}`}
      >
        {showDecisions && (
          <DeskCard
            tone="needs"
            title="Decisions"
            count={decisionCount}
            /* desk.py sorts the feed oldest-waiting first; "what each
               unblocks" is in the context line but is not the order yet
               (ASK-25 open question 1). Say what is true. */
            note="longest waiting first"
            loading={decisionsLoading}
            empty={SECTIONS[0].empty}
            rows={liveDecisions.map((c) => ({
              id: c.id,
              title: c.title,
              meta: c.context_line,
              amount: Number(c.amount) > 0 ? inrCompact(c.amount) : null,
              onOpen: () => setOpenDecisionId(c.target_id),
              /* ASK-32 1.3 and 2.4 — ONLY WHAT IS MINE TO DECIDE. The feed
                 already draws that line and it draws it on the server:
                 desk.py marks a card "review" when it sits in my approver
                 queue (or is unassigned and I am an owner) and "follow" when I
                 raised it and someone else decides — 2.4's "Waiting on Sunita"
                 row, which gets no actions at all. So a row I may not decide
                 renders no buttons rather than buttons the server would 403,
                 and the rule stays in one place instead of two. */
              actions: c.cta === "review" ? (
                <RowActions
                  what={c.title}
                  onApprove={() => approveRow(c.id, () => api.post(`/decisions/${c.target_id}/approve`),
                    `Approved — ${c.title}`)}
                  onReject={() => rejectRow(c.id, () => api.post(`/decisions/${c.target_id}/reject`),
                    `Rejected — ${c.title}`)}
                />
              ) : null,
            }))}
            moreSuffix=" waiting"
            cta={topDecision ? "Review" : null}
            onCta={() => topDecision && setOpenDecisionId(topDecision.target_id)}
            scroll
            testid="desk-decisions"
            className="lg:border-r lg:border-white/[.14] lg:pr-5"
          />
        )}

        {/* The same row cap again — this nested grid is itself a grid item, so
            without it Task approvals would push the board open on its own. */}
        <div className={`grid min-w-0 gap-5 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)] ${showDecisions ? "lg:pl-5" : ""} ${showApprovals ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-0" : ""}`}>
          {showApprovals && (
            <DeskCard
              tone="flag"
              title="Task approvals"
              count={approvalsQ.data ? liveApprovals.length : null}
              loading={!m.tasks}
              empty="Nothing waiting for your sign-off"
              rows={liveApprovals.map((t) => ({
                id: t.id,
                title: t.title,
                meta: [t.assignee_name, daysLabel(daysSince(t.created_at))].filter(Boolean).join(" · "),
                onOpen: () => setOpenTaskId(t.id),
                /* ASK-34 7.4 — the same two buttons, and REJECT GETS THE UNDO
                   HERE TOO. The brief said neither action needs one; read
                   against how a task approval is actually reversed, reject does.
                   routers/tasks.py reject_task pushes the task back to blocked
                   (or in_progress on a close-stage sign-off) and NOTIFIES every
                   assignee "Changes requested" the instant it lands — that
                   message cannot be recalled. And on a close-stage approval it
                   is not simply re-approvable: approve_task refuses unless
                   approval_status is still "pending", so the doer has to mark
                   the work complete again first. The work survives, so this is
                   lighter than a decision reject; a person hearing about it is
                   still a thing worth six seconds. Approve has none, as asked.
                   Every row here already passed _can_approve_task on the server
                   and canApproveTask on the client, so all of them get buttons. */
                actions: (
                  <RowActions
                    what={t.title}
                    onApprove={() => approveRow(t.id, () => api.post(`/tasks/${t.id}/approve`),
                      `Approved — ${t.title}`)}
                    onReject={() => rejectRow(t.id, () => api.post(`/tasks/${t.id}/reject`, { reason: "" }),
                      `Changes requested — ${t.title}`)}
                  />
                ),
              }))}
              cta="Approvals"
              /* The pill goes to My Work's Approvals view on MY approvals. */
              onCta={() => navigate("/my-work?view=approvals&scope=mine")}
              scroll
              testid="desk-approvals"
              className="lg:border-r lg:border-white/[.14] lg:pr-5"
            />
          )}

          <div className={`flex min-w-0 flex-col gap-2.5 ${showApprovals ? "lg:pl-5" : ""}`}>
            <StackCard
              tone="today"
              title="Due today"
              count={counters ? counters.due_today : null}
              loading={boardQs[2]?.isLoading}
              line={todayCards[0]?.title}
              empty={SECTIONS[2].empty}
              to="/my-work?filter=due_today"
              testid="desk-due-today"
            />
            {canApproveLeave && (
              <StackCard
                tone="warm"
                title="Leave requests"
                count={leavesQ.data ? pendingLeaves.length : null}
                loading={leavesQ.isLoading}
                line={leaveNames(pendingLeaves)}
                tail={pendingLeaves[0] ? leaveRange(pendingLeaves[0]) : ""}
                empty="No leave requests waiting"
                to="/my-work?view=approvals&sub=leave"
                testid="desk-leave"
              />
            )}
            <StackCard
              tone="fire"
              title="Slipping"
              count={counters ? counters.on_fire : null}
              loading={boardQs[1]?.isLoading}
              line={fireCards[0]?.title}
              tail={fireCards[0]?.context_line}
              empty={SECTIONS[1].empty}
              to="/my-work?filter=overdue"
              testid="desk-slipping"
            />
          </div>
        </div>
      </section>

      {openDecisionId && (
        <DecisionDialog decisionId={openDecisionId} open onClose={closeDecision} />
      )}

      {openTask && (
        <TaskCard
          drawerOnly
          t={openTask}
          open
          onToggleOpen={() => setOpenTaskId(null)}
          onChange={refreshTasks}
          members={usersQ.data || []}
          roleOptions={roleOptions}
        />
      )}
    </div>
  );
}
