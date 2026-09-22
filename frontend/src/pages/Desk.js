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
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { inrCompact } from "../lib/format";
import { cn } from "../lib/utils";
// ASK-36 2 — which decisions the founder read and set aside (see the file).
import { clearDeferred, deferDecision, getDeferred, pruneDeferred, subscribeDeferred } from "../lib/deferredDecisions";
import { selfScore } from "../lib/karmaScore";
import { isDemoTenant, demoDelta } from "./_operatingScoreDemo";
import { opModel } from "../lib/operatingModel";
// ASK-52 — the Workflows card and the numbers behind it.
import { WorkflowsTile } from "./desk/WorkflowsTile";
import { workflowAttention } from "./desk/workflowAttention";
import {
  ArcGauge, StatTile, ScopeSlider,
  BigNumeral, KDeltaChip, MiniBars, CircleDots, TinySpark,
} from "../components/karma";
import { INK_PLATE } from "../components/karma/glass";
import { useDeskMetrics } from "./desk/useDeskMetrics";
/* ASK-34 B — one DOM, not two. The phone's tabbed card and the desktop's three
   columns are different trees, and hiding one with `lg:hidden` would leave a
   phone carrying every desktop row as well as its own — duplicate testids at
   the same moment, and the audit counting rows nobody can see. hooks/useIsMobile
   is the app's own answer to exactly this and says so in its note: a JS branch
   keeps a single copy in the document. */
import { useIsMobile } from "../hooks/useIsMobile";
import { useServedFromCache } from "../hooks/useServedFromCache";
import { StaleStamp } from "../components/mobile/StaleStamp";
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
  ArrowSquareOut, CaretRight, CaretDown, Timer,
  ChatCircleText, Gauge as GaugeIcon, Receipt, HandCoins, FlowArrow,
} from "@phosphor-icons/react";

/* ASK-35 1.1 — how many rows the phone's card shows before the control. Three:
   the Desk's job on a phone is to say what is waiting, and the rest is one tap
   away. */
const PHONE_ROWS = 3;
/* ASK-47 · the pop. How long the card takes to grow out over the page and back
   — the app's own 260ms on its own ease — and the gap it leaves above the dock
   when it is open. It must never cover the bar. */
const POP_MS = 260;
const POP_SEAM = 10;
/* The gap the phone card leaves between its last pixel and the top of the
   floating dock. One seam, not a margin: the sheet's own dock clearance is what
   keeps the two apart, and this is only what the measurement holds back so the
   list never runs up against the bar.
   ASK-42 A — 4px, not 8. The card's own bottom padding sits inside this and the
   bar floats on a 16px inset below it, so the gap the eye sees is never this
   number alone; on a 6.1" screen the other four pixels are the difference
   between three rows that fit and three rows that make the page scroll. */
const DOCK_SEAM = 4;
/* ASK-35 1.4 — the inner card's material, lifted from the recipe the desktop
   top nav shelf is cut from (INK_PILL / .kr-navplate::before) so the two stay
   the same black. Only the fill and the lit top edge: INK_PILL's drop shadow
   and its hover brighten belong to a pressable pill, and this is a surface. */
// ASK-41 — the same string that More's tiles and the dock's live slot use,
// from the one place it is written (components/karma/glass.js).
const PHONE_CARD_INK = INK_PLATE;
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

/* ASK-40 3 — THE FEED READS NEWEST FIRST.
   desk.py builds /desk?chip=needs_decision oldest-first on purpose
   (_cards_needs_decision: "ASK-32: oldest first by the date it was
   captured"), which is why a decision raised a minute ago arrived at the
   BOTTOM of a thirty-row list. The founder's call is the other way round, and
   backend/ is not ours to change, so the flip happens here.
   The cards carry no timestamp — the only date on them is the sentence
   "Waiting 6 days" inside context_line, which is a string — but they arrive in
   two runs: everything I decide (cta "review"), then everything I merely
   follow (cta "follow"), each already ascending by created_at. Reversing each
   run is therefore EXACTLY newest-first, with no date parsing anywhere, and it
   leaves the two groups where they were: what I can act on still sits above
   what I am only watching. */
const newestFirst = (cards) => {
  const review = [];
  const follow = [];
  for (const c of cards) (c.cta === "follow" ? follow : review).push(c);
  return [...review.reverse(), ...follow.reverse()];
};

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

/* ASK-41 1 — THE ROW'S APPROVE AND REJECT ARE GONE, on both surfaces.
   ASK-34 7.3 put a circular tick and cross on every row a person could decide,
   and B4 carried them to the phone; the founder's call now is that a decision
   is not a thing you commit from a list. The row opens the decision and the
   decision is taken in the window that shows you what you are deciding — the
   DecisionDialog for a decision, TaskCard's drawer for a task approval. Both
   already carry the full pair, so nothing moved and nothing is now unreachable.
   Everything that existed only to serve those two buttons went with them: the
   undo window and its snackbar, the `retiring` set that hid a row while the
   window ran, and the approve/reject/commit helpers. A reject reaches the
   server through the window's own reason flow now, which is a confirmation in
   its own right, so there is nothing left to take back six seconds later. */

/* ASK-34 B5 · DeskRow — ONE ROW, TWO CONTAINERS. The desktop's three columns
   and the phone's tabbed card are different boxes holding the same thing, and
   a second copy of this markup is exactly the drift the component audit exists
   to catch: the inline approve/reject, the 403-avoiding rule behind them, the
   amount, the open icon and the row-is-the-link behaviour would all have had to
   be written twice and kept in step by hand. So the row is a component and the
   container is the variable.
   `data-row` is what both containers measure a row's height with; the testid
   pattern is the caller's, so desk-decisions-row-<id> means the same element in
   either one. */
function DeskRow({ r, first, testid }) {
  return (
    <div
      data-row=""
      role="link"
      tabIndex={0}
      onClick={r.onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") r.onOpen(); }}
      data-testid={`${testid}-row-${r.id}`}
      data-deferred={r.deferred ? "true" : undefined}
      /* ASK-36 2 — A ROW THE FOUNDER SET ASIDE. Dex finished reading their
         capture, they pressed "Later" instead of Review, and until now the
         decision landed back in this column indistinguishable from the ones
         that arrived while they were not looking. It is marked: the section's
         own hue as a 2px bar down the left edge and the faintest wash behind
         it, the title lifted from neutral-300 to full white. Not a chip and not
         a colour on the text — the row is dense and already carries an amount,
         two actions and a link, and this has to read at a glance without
         competing with any of them. The mark is spoken too, in the meta line,
         so it is not colour alone. */
      /* ASK-42 A — 4px of vertical padding below lg instead of 7. Three rows
         is the founder's floor for this card and a 6.1" screen is 29px short of
         holding them; six of those pixels are here, three times over. Desktop
         keeps its 7 — it has the room and the columns are read at arm's
         length. */
      className={`flex cursor-pointer items-center justify-between gap-3 max-lg:py-1 py-[7px] ${first ? "" : "border-t border-white/[.14]"} ${
        /* ASK-42 E — THE MARK IS LOUDER. It was a 2px bar and a 5% white wash,
           which on near-black is a shade of the same black: the founder could
           see it only once they knew where to look. It is the SAME grammar,
           turned up — the section's own hue instead of white, a 3px bar, a 14%
           fill of that hue, a hairline ring of it around the whole row, and a
           soft outer glow in it so the row lifts off the card rather than
           merely tinting. Still not kr.accent, which is alert grammar and not
           this; still spoken as "Set aside" in the meta line, so it is not
           colour alone. */
        r.deferred
          ? "-mx-2 rounded-xl border-l-[3px] border-l-[hsl(var(--kr-glass-from))] bg-[hsl(var(--kr-glass-from)/0.16)] px-2 shadow-[inset_0_0_0_1px_hsl(var(--kr-glass-from)/0.30),0_0_16px_-4px_hsl(var(--kr-glass-from)/0.55)]"
          : ""
      }`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className={`truncate text-[15px] font-medium leading-5 tracking-[-0.006em] ${r.deferred ? "text-white" : "text-neutral-300"}`}>{r.title}</p>
        {(r.meta || r.deferred) && (
          <p className="truncate text-xs leading-4 text-neutral-500">
            {r.deferred && <span className="font-medium text-neutral-300">Set aside</span>}
            {r.deferred && r.meta ? " · " : ""}
            {r.meta}
          </p>
        )}
      </div>
      {/* ASK-41 1 — the amount, then the open icon, 10px apart. The tick and
          cross that used to sit between them are gone; the row is the link and
          the window it opens is where a decision is taken. */}
      <span className="flex shrink-0 items-center gap-2.5">
        {r.amount && <span className="font-mono text-[13px] leading-5 text-neutral-400">{r.amount}</span>}
        <OpenButton onClick={(e) => { e.stopPropagation(); r.onOpen(); }} label={`Open: ${r.title}`} />
      </span>
    </div>
  );
}

function CountPill({ n, onInk = false }) {
  return (
    // ASK-43 — 1.5px of vertical padding below lg, so a count inside a Watch
    // card cannot make that card taller than the decision row it now matches.
    <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold tabular-nums max-lg:px-1.5 max-lg:py-0 ${onInk ? "bg-white/[.10] text-white/80" : "bg-kr-ink/[.08]"}`}>
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
             is untouched: it does not grow and it does not scroll.
             ASK-40 4 — and it shows NO BAR. `scrollbar-width: thin` was still
             a bar, permanent on any platform that paints them, running down
             the column's edge next to the real rule; .kr-scroll-quiet
             (index.css) hides it and leaves the scrolling alone. The heading's
             "N more waiting" is what says there is more. */
          className={`min-h-0 flex-1 overflow-hidden ${scroll ? "kr-scroll-quiet lg:overflow-y-auto lg:pr-1" : ""}`}
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
            <DeskRow key={r.id} r={r} first={i === 0} testid={testid} />
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

/* ASK-34 B · THE PHONE'S BLACK CARD IS THREE TABS.
   It was one column stacked on another stacked on a third — 889px of card on
   an 844px screen, so the founder was always scrolling it with the floating
   dock hovering over whatever they were reading. Decisions, Approvals and the
   three watch feeds become three tabs of one card instead, and the card is
   sized to end above the dock.
   TAP ONLY. No swipe between tabs: the rows carry their own actions and a
   horizontal drag starting on a row would have to decide, every time, whether
   it meant the tab strip or the row — and getting that wrong either changes
   the tab under a thumb aiming at a button or eats a scroll. The founder's
   call, and it is the right one.
   NO SCROLL REGION INSIDE. A scrollport nested in a scrolling page is a trap
   on a phone: the inner one swallows the gesture and the page appears stuck.
   The card shows what fits and a control opens the rest in place, so there is
   only ever one thing scrolling — the page. */
/* ASK-47 — TWO FLAGS, NOT ONE, and the difference is what makes the pop
   measurable. `open` says the whole list is rendered; `scrolls` says the card
   has reached its full size and the list inside it is now the scroller. They
   are one frame apart on purpose: the page measures the card between them,
   when every row is in the DOM and nothing is yet clipping them, which is the
   only moment the content's real height can be read. Tied together, the
   measurement read the height of three rows and the card grew to exactly the
   size it already was. */
function PhoneTabCard({ tone, testid, rows, loading, empty, tabs, tab, onTab, open, scrolls, onToggleExpanded, children }) {
  const showAll = open;

  /* ASK-35 1.1 — THREE, AND THEN A CONTROL: the Desk's job on a phone is to say
     what is waiting, not to show it all.
     ASK-46 — AND THE CARD IS THE HEIGHT OF THREE ROWS NOW, so there is nothing
     left in here to measure. It used to stretch to the sheet's floor, which is
     why three tickets ran on arithmetic about the room left above the dock: a
     trim that could only agree with itself (ASK-40), a budget taken against the
     dock's own line (ASK-41), a floor of three the budget was not allowed to
     negotiate away (ASK-42). The founder's call here retires the lot — the card
     hugs its three rows, the page places it, and whether the PAGE fits is the
     page's question (`tooTall`, in Desk below). What is left of this component
     is what it draws.

     ASK-47 — AND OPEN/CLOSED IS THE PAGE'S STATE NOW, not this card's. Opening
     no longer grows a list inside a page; it pops this whole card out over the
     page, and the page is what dims behind it, what closes it when tapped, and
     what knows where the card has to grow to. A card cannot own a state the
     page has to act on. */
  // ASK-42 A — three, always (see the measure above); "Show all" is the rest.
  const shown = showAll ? rows : rows.slice(0, PHONE_ROWS);
  const hidden = rows.length - shown.length;

  return (
    /* min-w-0: a grid item defaults to min-width:auto, i.e. its min-content,
       and a truncated title's min-content is the WHOLE title — which grew this
       card to 568px inside a 358px board. */
    <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${TONE[tone]}`} data-testid={testid}>
      {/* THE TITLE ROW IS THE TABS. One segment material app-wide (KM-54..60):
          this is ScopeSlider, the Company/You control, cut for ink and sharing
          the width three ways. --tabs-trigger-h is the app's own tab height
          token — 44px below lg, which is also the touch floor. */}
      <ScopeSlider
        fluid
        variant="ink"
        segHeight="var(--tabs-trigger-h)"
        options={tabs}
        value={tab}
        onChange={onTab}
        label="Desk sections"
        testid="desk-tab"
      />

      {/* ASK-35 1.4 — THE LISTS LIVE ON A CARD, THE STRIP DOES NOT. The strip
          sits straight on the sheet (above); everything a tab holds sits on a
          card inside it, so the sheet reads as a surface with something on it
          rather than as one undifferentiated black rectangle.
          THE FILL IS THE DESKTOP TOP NAV SHELF'S — INK_PILL / .kr-navplate's
          ::before: a 24%->6% vertical gradient with a 16% white lip on the top
          edge. Taken from the recipe (components/karma/glass.js) rather than
          retyped, so the two cannot drift. Against the sheet's hsl(240 4% 9%)
          ground the card is lighter at its head and all but equal at its foot,
          which is the step that does the work — no border and no ring, because
          either would draw the edge the gradient is already implying.
          IT HUGS ITS CONTENT: no flex-1, no min-height. It ends where the last
          row or the show-all control ends, and the sheet's own padding-bottom
          (index.css, ASK-35 1.2) is what holds it clear of the dock. */}
      {/* ASK-42 A — p-2.5, not p-3: the last four pixels of the thirty the
          6.1" screen needed. */}
      {/* ASK-43 — IT HUGS ITS CONTENT AGAIN, which is what ASK-35 1.4 wrote
          three lines above and what `flex-1` had quietly undone. At the phone's
          new 0.8 scale the sheet has room to spare and a stretched card spent
          it on a field of empty grey under the last row; hugging, the card ends
          where its content ends and the slack is the sheet's own black. The
          measurement never needed the stretch — it is taken against the dock's
          line, not the card's box. */}
      {/* ASK-47 — WHEN THE CARD IS POPPED, THIS FILLS IT AND THE LIST SCROLLS.
          At rest the card hugs its three rows (ASK-46) and nothing inside it
          scrolls; open, it is the height of the screen and the list is the only
          thing in the app that has more than it can show, so the list is where
          the scrolling goes. `min-h-0` on both is what lets a flex child be
          shorter than its content — without it the list would push the card
          past the bottom of the screen instead of scrolling inside it. */}
      {/* ASK-49 — AT REST THE BODY IS ONE FIXED HEIGHT (index.css,
          --desk-phone-body): three rows and the show-all slot, in every tab and
          every state, empty included. The list takes the top of it and the
          slot the foot, so a tab with nothing in it is the same card as one
          with thirty. Only while it is OPEN is it released — the pop measures
          the whole list in that one frame and then sizes the card to it, which
          a fixed height would have clipped to three rows again. */}
      <div
        className={cn(PHONE_CARD_INK, "mt-1.5 min-h-0 rounded-tile p-2.5",
          scrolls ? "flex flex-1 flex-col" : !open && "flex flex-col")}
        style={!open ? { height: "calc(var(--desk-phone-body) + 1.25rem)" } : undefined}
        data-testid={`${testid}-card`}
      >
        <div className={scrolls ? "kr-scroll-quiet min-h-0 flex-1 overflow-y-auto" : !open ? "flex min-h-0 flex-1 flex-col" : undefined}>
        {children || (
          <>
            {loading && (
              <div className="space-y-2" aria-hidden="true">
                <div className="ds-skeleton h-5 w-4/5 rounded-control" />
                <div className="ds-skeleton h-5 w-3/5 rounded-control" />
              </div>
            )}
            {!loading && rows.length === 0 && (
              /* ASK-49 — centred in the three rows' space it is standing in
                 for, so an empty tab reads as a card with nothing on it rather
                 than a card with one short line and a hole under it. */
              <p className="m-auto py-3 text-center text-sm text-neutral-500" data-testid={`${testid}-empty`}>{empty}</p>
            )}
            {!loading && shown.map((r, i) => (
              <DeskRow key={r.id} r={r} first={i === 0} testid={`desk-${tab}`} />
            ))}
          </>
        )}
        </div>

        {/* THE MORE CONTROL — it opens the rest HERE, in place, and the page
            scrolls as it always does. Nothing new to learn and nothing nested.
            ASK-46 — AND IT IS TEXT WITH A CARET, NOT A PILL. The founder's call:
            a filled bar across the foot of the card was reading as the card's
            main action when what it does is reveal the rest of a list. A line of
            type with a chevron under it says the same thing at a fraction of
            the weight — and the row keeps the 44px touch floor, so what changed
            is what it looks like, not what a thumb gets. The chevron points
            down to open and up to close, which is the one thing a caret is
            unambiguous about. */}
        {/* ASK-49 — and when there is nothing more to show, its SPACE stays:
            an empty slot the same 48px, so a tab with two rows is not shorter
            than a tab with thirty. */}
        {!children && !open && (loading || !(hidden > 0 || showAll)) && (
          <div aria-hidden="true" className="mt-1 h-11 shrink-0" data-testid="desk-phone-more-slot" />
        )}
        {!children && !loading && (hidden > 0 || showAll) && (
          <button
            type="button"
            data-testid="desk-phone-more"
            onClick={onToggleExpanded}
            aria-expanded={showAll}
            className="mt-1 flex h-11 w-full shrink-0 items-center justify-center gap-1 text-[13px] font-medium text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-0"
          >
            {showAll ? "Show fewer" : `Show all ${rows.length}`}
            <CaretDown size={12} weight="bold" aria-hidden="true" className={showAll ? "rotate-180" : ""} />
          </button>
        )}
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
      {/* ASK-43 — ON A PHONE THIS CARD IS A ROW. Watch's three feeds sat at
          70px each against the 52px of a decision or an approval in the tabs
          beside them, so switching tabs changed the scale of the list as well
          as its contents. Below lg the type, the padding and the dot all step
          down to DeskRow's — 15px title over a 12px line, 4px of padding, the
          same 2px between them — and the three cards measure what three rows
          measure. Desktop is untouched: there the same cards are a column of
          their own beside the lists, not a substitute for them. */}
      <div className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 max-lg:gap-2 max-lg:px-2.5 max-lg:py-1.5">
        <div className="flex min-w-0 flex-col gap-1 max-lg:gap-0.5">
          <div className="flex min-w-0 items-center gap-2 max-lg:gap-1.5">
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-[hsl(var(--kr-glass-from))] max-lg:h-2 max-lg:w-2" />
            <h3 className="text-base font-medium tracking-[-0.006em] text-white/85 max-lg:text-[15px] max-lg:leading-5">{title}</h3>
            <CountPill n={count} onInk />
          </div>
          {loading
            ? <div className="ds-skeleton h-4 w-2/3 rounded-control" aria-hidden="true" />
            : <p className="truncate text-sm text-neutral-300 max-lg:text-xs max-lg:leading-4">
                {line
                  ? <>{line}{tail && <span className="text-neutral-500"> &middot; {tail}</span>}</>
                  : <span className="text-neutral-500">{empty}</span>}
              </p>}
        </div>
        <CaretRight size={22} weight="bold" aria-hidden="true" className="kr-arrow shrink-0 text-white/50 transition-transform duration-200 max-lg:h-[18px] max-lg:w-[18px]" />
      </div>
    </Link>
  );
}

// The Desk's own data, as its requests name it (baseURL /api).
const DESK_DATA = ["/desk", "/tasks", "/workflows", "/operating-score", "/ledger/summary", "/leaves", "/brief"];

export default function Desk() {
  const navigate = useNavigate();
  const { user, tenant } = useAuth();
  const m = useDeskMetrics();
  const isMobile = useIsMobile();
  /* ASK-52 — the boards behind the Workflows tile. with_tasks=true brings the
     open tasks at each card's current stage, which is what "needs you",
     "stuck" and "late" are read from (pages/desk/workflowAttention). Same
     query key the Workflows page uses, so a move made here refreshes there. */
  const workflowsQ = useQuery({
    queryKey: ["workflows", "attention"],
    queryFn: () => api.get("/workflows?with_tasks=true").then((r) => r.data),
    refetchInterval: 60000,
  });
  const wfAttention = useMemo(() => workflowAttention({
    workflows: workflowsQ.data || [],
    userId: user?.id,
    isOwner: user?.role === "owner",
    pipelines: opModel(tenant).pipelines,
  }), [workflowsQ.data, user, tenant]);

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
  const [rawDecisions, fireCards, todayCards] = [cardsOf(0), cardsOf(1), cardsOf(2)];
  // ASK-40 3 — one place, so the desktop column and the phone tab cannot
  // disagree about the order: everything below reads `decisionCards`.
  const decisionCards = useMemo(() => newestFirst(rawDecisions), [rawDecisions]);

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
      // ASK-40 3 — newest first, like the decisions beside it. Tasks DO carry
      // created_at, so this one is a straight flip of the comparison.
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))),
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
  /* JOURNEY-1 J13 — on a slow line the phone's saved copy stands in for the
     server after 3 s (service-worker.js), and the Desk used to show those
     numbers as if they were live. Now it says when they are from. */
  const cachedAt = useServedFromCache(DESK_DATA);
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
  /* Anything that has left the feed has been decided, so it stops being
     deferred. */
  /* Keyed on target_id, which IS the decision's id — desk.py writes the same
     value into `id` and `target_id`, and `target_id` is the one the well's
     ending hands back, so this is the field that can never drift. */
  useEffect(() => { if (decisionCards.length) pruneDeferred(decisionCards.map((c) => c.target_id || c.id)); }, [decisionCards]);
  /* ASK-34 B1 — the phone's three tabs. `watch` is the group that was three
     stacked cards under the two columns: Due today, Leave requests, Slipping.
     Its badge is the three counts together, because the tab is the three feeds
     together. */
  const [phoneTab, setPhoneTab] = useState("decisions");
  /* ASK-39 1 — "Show all" is the one thing that makes the phone's Desk taller
     than a screen, so the page has to know about it.
     ASK-47 — and it no longer makes it taller: the card POPS instead, out over
     the page, growing from where it sits toward the top and the dock at the
     same time. This is the state that drives all of it. */
  const [phoneExpanded, setPhoneExpanded] = useState(false);
  // A new tab starts closed: the last tab's "show everything" is not a claim
  // about this one.
  useEffect(() => { setPhoneExpanded(false); }, [phoneTab]);
  /* THE POP'S GEOMETRY, in the element's own pixels. `rest` is where the card
     sits on the page, measured the moment it is opened; `full` is the screen
     between the top bar and the dock. The card is rendered fixed at `rest` for
     one frame and then at `full`, so the browser has two values to transition
     between and the card grows UP and DOWN at once — which is the thing the
     founder asked for and the thing a height animation alone cannot do. */
  const boardRef = useRef(null);
  const [pop, setPop] = useState(null); // { rest, full, at: "rest" | "full" }
  useEffect(() => {
    if (!isMobile) { setPop(null); return undefined; }
    const board = boardRef.current;
    if (!board) return undefined;

    if (!phoneExpanded) {
      // Closing: back to the resting geometry, then out of fixed altogether.
      setPop((p) => (p ? { ...p, at: "rest" } : null));
      const t = setTimeout(() => setPop(null), POP_MS);
      return () => clearTimeout(t);
    }

    const rect = board.getBoundingClientRect();
    /* ASK-43's two spaces again: a fixed element inside the zoomed app is
       positioned in the app's OWN pixels, and every rect here is in visual
       ones. `k` converts, and is exactly 1 wherever there is no zoom. */
    const scaleVar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"));
    const k = scaleVar > 0 ? 1 / scaleVar : (rect.width ? board.offsetWidth / rect.width : 1);
    const dock = document.querySelector('[data-testid="floating-dock"]');
    const topBar = document.querySelector('[data-testid="desk-topbar"]');
    const topOwn = (topBar ? topBar.getBoundingClientRect().top : rect.top) * k;
    const dockTopOwn = dock ? dock.getBoundingClientRect().top * k : window.innerHeight * k;
    /* Converted from the rect, NOT read off offsetWidth/offsetHeight: those are
       rounded to whole pixels, and the spacer below stands in for this box in
       the flow. A rounded height there left half a pixel between them, which
       nudged Dex up by one screen pixel when the card lifted. */
    const rest = {
      top: rect.top * k,
      left: rect.left * k,
      width: rect.width * k,
      height: rect.height * k,
    };
    /* AS TALL AS THE LIST IS, AND NO TALLER. The founder: "it should grow
       according to the list of items it has… depending upon the list of items
       it will cover the entire screen". So the target height is the card's own
       natural height with every row in it, capped at the screen between the top
       bar and the dock — six decisions open a card of six, thirty open a full
       screen with the list scrolling inside it.
       It is measured one frame LATER, with the whole list already rendered at
       the resting geometry: scrollHeight then reports what the content wants.
       (Which is also why the inner list only becomes a scroller at `full` —
       measuring a scroller would report the box, not the content.) */
    setPop({ rest, full: rest, at: "rest" });
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const maxH = Math.max(rest.height, dockTopOwn - POP_SEAM - topOwn);
        /* How much MORE the content wants than the box it is in. The board is
           a grid whose row is minmax(0,1fr), so the overflow does not surface
           on the board itself — it surfaces on the first descendant the row
           squeezes, which is the list's own card. Take whichever reports it. */
        const inner = board.querySelector(`[data-testid="desk-phone-card-card"]`);
        const extra = Math.max(
          board.scrollHeight - board.clientHeight,
          inner ? inner.scrollHeight - inner.clientHeight : 0,
          0
        );
        const height = Math.min(rest.height + extra, maxH);
        /* AND IT GROWS FROM ITS CENTRE — up and down at once, which is the
           whole of the founder's ask. Held inside the same two lines: never
           above the top bar, never over the dock. */
        const centre = rest.top + rest.height / 2;
        const top = Math.max(topOwn, Math.min(centre - height / 2, dockTopOwn - POP_SEAM - height));
        setPop((prev) => (prev ? { ...prev, full: { ...rest, top, height }, at: "full" } : prev));
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [phoneExpanded, isMobile, phoneTab]);

  // Escape closes it, like every other layer in the app.
  useEffect(() => {
    if (!phoneExpanded) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setPhoneExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phoneExpanded]);
  /* ASK-36 2 — the ids of decisions set aside with "Later". Subscribed rather
     than read once, because the well writes to the store while this page is
     mounted. */
  const [deferred, setDeferred] = useState(getDeferred);
  useEffect(() => subscribeDeferred(setDeferred), []);
  const watchCount = (counters?.due_today || 0) + (canApproveLeave ? pendingLeaves.length : 0) + (counters?.on_fire || 0);
  /* ASK-41 1 — the server's count, plainly. It used to subtract the rows an
     undo window was hiding; there is no such row any more. */
  const decisionCount = counters ? counters.needs_decision : null;

  /* ASK-34 B2 — THE ACTIVE TAB COUNTS, THE OTHERS ONLY SAY "SOMETHING". A
     number on every tab would be three numbers competing on a 360px strip; no
     signal at all would leave nothing to tell the founder a tab is worth
     switching to, which is the only reason tabs exist here. So the active one
     carries its number in a badge and an inactive one with anything in it
     carries a dot in its own section hue (the TONE class sets --kr-glass-from
     on the element the dot reads it from). Empty tabs carry nothing, and the
     dot's meaning is spoken for screen readers rather than left to colour. */
  const tabOption = (key, label, n, tone) => ({
    key,
    label: (
      <span className="inline-flex items-center justify-center gap-1.5">
        {label}
        {n > 0 && (phoneTab === key ? (
          <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-white/25 px-1 text-[11px] font-semibold tabular-nums text-white">
            {n}
          </span>
        ) : (
          <>
            <span aria-hidden="true" className={`${TONE[tone]} h-1.5 w-1.5 rounded-full bg-[hsl(var(--kr-glass-from))]`} />
            <span className="sr-only">, {n} waiting</span>
          </>
        ))}
      </span>
    ),
  });
  const phoneTabs = [
    tabOption("decisions", "Decisions", decisionCount ?? 0, "needs"),
    tabOption("approvals", "Approvals", approvalsQ.data ? approvals.length : 0, "flag"),
    tabOption("watch", "Watch", watchCount, "today"),
  ];
  const decisionRows = decisionCards.map((c) => ({
    id: c.id,
    title: c.title,
    meta: c.context_line,
    amount: Number(c.amount) > 0 ? inrCompact(c.amount) : null,
    onOpen: () => { clearDeferred(c.target_id); setOpenDecisionId(c.target_id); },
    // ASK-36 2 — read, then set aside. The row says so.
    deferred: deferred.includes(c.target_id),
  }));
  /* ASK-41 1 — the row opens the task; TaskCard's drawer is where it is
     approved or rejected. Its approval block carries both, and the reject there
     asks for a reason before anything reaches the server — which is the reason
     the row's own reject needed a six-second undo and this one does not. */
  const approvalRows = approvals.map((t) => ({
    id: t.id,
    title: t.title,
    meta: [t.assignee_name, daysLabel(daysSince(t.created_at))].filter(Boolean).join(" · "),
    onOpen: () => setOpenTaskId(t.id),
  }));

  /* ASK-46 — one well, two places (see the call sites). The className is the
     only thing that differs: in the hero it takes the column's remaining
     height; at the foot of the page `mt-auto` pushes it down to sit just above
     the dock, which is where the founder wants Dex to live. */
  const dexWell = (
    <DeskDexWell
    /* ASK-35 2.2 — `max-lg:flex max-lg:flex-col` is what stops the
       composer row moving when the workspace opens. The pane is
       `h-full`, and a percentage height against a parent that has only
       a MIN-height computes to auto — so on a phone the pane was
       content-sized (133px) inside a 150px well, sitting 17px clear of
       its own floor, and the moment it went position:absolute it
       anchored to the well's real bottom and took the composer 17px
       down with it. As a column flex parent the well stretches the pane
       to its full box at rest, so the two agree before and after. On
       desktop `lg:flex-1` already gives the well a definite height and
       nothing changes. */
    /* ASK-42 A — 138px below lg, down from 150. What the well has to
       hold at rest is its label, one line of invitation and the 48px
       composer row inside 16px of padding; 138 fits that with the
       composer still on its own line, and the 12 it gives back go to
       the list. lg keeps flex-1 and is untouched. */
    /* ASK-42 A — 128px below lg, and the number is not free choice: it
       has to be AT LEAST the well's own resting content height (125 with
       the phone's 12px pane padding). The pane lifts out of the flow
       when the workspace opens and anchors to the well's bottom; if the
       min-height is under the content, the well collapses to it the
       instant the pane leaves and the composer the founder just typed
       into rises by the difference — the exact 7px ASK-35 2.2 spent a
       ticket removing. Anything at or above the content height pins the
       well and the composer cannot move. */
    /* ASK-47 — ON A PHONE IT TAKES WHAT IS LEFT. The founder wants the space
       between the card and the dock filled by Dex rather than left empty, and
       filled with a near-square container: the ripple mic needs a square to
       live in, not the compact strip a composer needs. `flex-1` hands it every
       pixel the hero and the card did not use, with a floor so it is never
       less than a well; on the screens the founder cares about (6"+) that is a
       square or better, and on the shortest phones it simply gets smaller,
       which is what they said to do with those. */
    className={cn(
      isMobile
        /* `min-h-0`, not a floor. A floor is the one thing that can push this
           page past the screen, and the founder's answer for the phones too
           short to hold a square was "scale down to fit exact" — so the well
           takes what is left and the ripple inside it is drawn at whatever
           that turns out to be. On 6" and up that is a square; on a 5.4" it is
           a letterbox with a smaller mic in it, and nothing scrolls either
           way. */
        ? "min-h-0 flex-1 flex flex-col"
        : "order-4 min-h-[128px] max-lg:flex max-lg:flex-col lg:order-none lg:min-h-0 lg:flex-1"
    )}
    testid="desk-insight"
    phone={isMobile}
    growToRef={kpiGridRef}
    /* ASK-35 2.2 — below lg the well grows to the top of the HERO,
       covering the greeting, the score cluster and the KPI strip. */
    growToPhoneRef={heroRef}
    onExpandedChange={setDexExpanded}
    onReview={(id) => { clearDeferred(id); setOpenDecisionId(id); }}
    onLater={(id) => { deferDecision(id); setDeferred(getDeferred()); }}
          />
  );

  return (
    /* ASK-25 — ONE SCREEN. On desktop the page is a flex column that fills
       the frame Layout hands it (lg:h-full on the content wrapper): the hero
       takes its natural height and the desk below takes the rest, so the
       whole Desk sits inside the viewport and nothing scrolls. Below lg the
       same tree simply stacks and the phone scrolls. */
    /* ASK-36 3 / ASK-39 1 — THE PHONE'S DESK IS ONE SCREEN, AND ONLY "SHOW ALL"
       MAKES IT SCROLL.
       ASK-36 gave the page a FLOOR of one viewport so the black sheet always
       reached the bottom of the screen. A floor is not a ceiling: the hero and
       the sheet together came to more than a screen, so the page scrolled and
       the greeting slid away under the status bar (the founder's two
       screenshots are the same page at two scroll positions). It is an exact
       height now — from the page's own top to the bottom of the screen — so at
       rest there is nothing to scroll, and the sheet still reaches the floor
       because its negative bottom margin (index.css) bleeds it over the dock
       clearance below.
       THE TOP is what the header slot and the wrapper put above it:
       env(safe-area-inset-top) + 0.5rem (the slot's own padding on /inbox,
       Layout.js) + 1rem (the wrapper's p-4). Written as that sum rather than
       as the 24px it computes to, so it follows if either moves.
       `100svh`, the SMALL viewport, so a phone's collapsing URL bar can only
       ever leave room rather than take it.
       WHEN "SHOW ALL" IS OPEN the height comes off entirely and the page grows
       to its content — which is the one moment the founder asked to be able to
       scroll. Nothing here applies at lg, where ASK-35 G3 made the board a card
       on a page on purpose. */
    <div
      data-testid="desk-page"
      data-phone-expanded={phoneExpanded ? "true" : undefined}
      data-cached={cachedAt ? "true" : undefined}
      className={cn(
        "flex flex-col gap-3 lg:gap-6 lg:min-h-0 lg:flex-1",
        /* ASK-42 A — h-full, not a copy of the shell's arithmetic. This was
           `100svh - env(safe-area-inset-top) - 1.5rem`: the viewport, less what
           the shell puts above <main>, guessed from here. It was right until
           the Desk's top bar came back (ASK-42 D) and then it was wrong by the
           bar's height on every phone. Layout gives this page's wrapper main's
           own height below lg, so `h-full` is the true one and stays true
           whatever else the shell grows above it. */
        /* ASK-47 — always h-full below lg. The page used to grow when the
           list opened; the list pops over it now, so the page is one screen in
           every state and there is nothing left that can make it scroll. */
        "max-lg:h-full"
      )}
    >
      {cachedAt && (
        <StaleStamp at={cachedAt} offline={typeof navigator !== "undefined" && navigator.onLine === false}
          onRetry={() => qc.invalidateQueries()} className="shrink-0" data-testid="desk-stale" />
      )}
      {/* ── LIGHT ZONE ───────────────────────────────────────────────── */}
      {/* KR-8.6 — the split and the gaps are MEASURED off the reference:
          36 / 56 with a wide 8% trough between. */}
      {/* ASK-42 A — THE GAPS COME IN ON A PHONE: 16px below lg, the reference's
          24 from lg up. Three of them stack between the greeting, the tiles and
          the well, so eight pixels each is 24 handed to the sheet — and on a
          6.1" screen with a 47px notch inset and a 34px home indicator, 24px is
          what a row of the list costs. Desktop is untouched. */}
      <div ref={heroRef} className="kr-hero flex flex-col gap-3 lg:grid lg:shrink-0 lg:grid-cols-[minmax(0,29fr)_minmax(0,45fr)] lg:gap-20">
        {/* LEFT column — greeting, the score row, the well on the floor.
            KR-14.2 · MOBILE — display:contents so its children flow into
            the outer column and the KPI strip can slot between them. */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-3">
          {/* Greeting on the LEFT, compact score+gauge on the RIGHT on the
              phone; on lg the greeting stands alone, two lines, the name
              carrying the weight (the founder's reference). */}
          {/* ASK-42 A — ONE HEIGHT FOR BOTH HALVES. The greeting is a sentence
              of unknown length and the score is two fixed lines, so the row was
              whatever the longer one wanted: "Good morning, Rajesh." broke to
              three lines beside a two-line score and the sheet below paid for
              the extra one. `line-clamp-2` caps the greeting at the score's own
              height and `items-center` centres the shorter half against the
              taller, so neither can now push the other down. lg is unchanged —
              there the greeting has its own column and all the room it wants. */}
          <div className="kr-dex-fade order-1 flex items-center justify-between gap-4 lg:order-none lg:block lg:items-start" data-dex-faded={dexExpanded ? "true" : "false"}>
            {/* ASK-43 — 22px on a phone, down from 24. The founder's screen was
                showing "Good afternoon,…" with the name eaten by the clamp; the
                app's new 0.8 scale (hooks/useUiScale) already gives this line
                half again as much room in its own pixels, and the two points
                off the size are the margin — a longer name than Rajesh still
                lands inside the two lines rather than in an ellipsis. Two lines
                at 22 is 56px against the score's 60, so it still cannot make
                this row taller than the score does. */}
            <h1 className="min-w-0 font-display text-xl leading-tight lg:text-[34px] lg:font-light lg:leading-[1.15]" data-testid="desk-brief-greeting">
              {gi === -1
                ? <span className="block truncate">{greeting || " "}</span>
                : <>
                    {/* ASK-43 — TWO LINES, ONE EACH, AND THE NAME IS ONE OF
                        THEM. They were inline spans under a two-line clamp, so
                        the greeting and the name shared whatever wrapping the
                        column allowed — and on a narrow screen "Good afternoon,"
                        took both lines and the clamp ate the name, which is the
                        founder's "the name is totally disappeared". As blocks
                        they are a line each: the name cannot be pushed off,
                        because it is not competing for the first line. And each
                        line truncates on its own, so if anything has to give it
                        is the end of ONE line rather than the whole of the
                        second. 20px on a phone (the founder: "it's okay to
                        shrink the font"), which is what makes "Good afternoon,"
                        fit a 320px screen with the display zoomed. */}
                    <span className="block truncate">{greeting.slice(0, gi + 1)}</span>
                    <span className="block truncate text-muted-foreground lg:text-5xl lg:font-bold lg:leading-[1.08] lg:tracking-[-0.02em] lg:text-foreground">{greeting.slice(gi + 1)}.</span>
                  </>}
            </h1>

            {/* Compact score cluster — mobile only.
                ASK-42 A — AND THE COMPANY/YOU SWITCH IS OFF THE PHONE AGAIN.
                ASK-40 put it here on the founder's mark; their call now is that
                the band it filled is worth more to the list below — 52px of
                switch plus its gap is a row of decisions on a 6.1" screen. The
                desktop keeps it (the row below), and `scope` still drives the
                numeral, so a phone simply shows the company score the Desk has
                always opened on. */}
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

          {/* ASK-46 — ON DESKTOP THE WELL IS STILL HERE, in the hero's left
              column under the score, exactly as ASK-25 placed it. On a phone it
              is not: the founder moved it to the foot of the page, above the
              dock, and the black card took its place. `isMobile` decides which
              of the two call sites renders, so only ever ONE instance exists —
              the well owns the Dex workspace's state and two of them would be
              two conversations. Crossing the lg line remounts it, which a
              breakpoint change does to this whole page anyway. */}
          {!isMobile && dexWell}
        </div>

        {/* KR-14.20 · MOBILE — the KPIs are four rounded rectangles in a
            2×2 grid. Each card: label on the LEFT, icon + numeral aligned
            to the RIGHT. Score-mix and Spend are dropped per the founder;
            the four kept are Delayed, Complaints, Overdue and — ASK-52 —
            Workflows, which took Net profit's place. */}
        {/* ASK-35 2.3 — the pane grows over this now, so it fades with the
            greeting above it. Anything it covers fades; anything it does not,
            does not. */}
        <div
          className="kr-dex-fade order-3 grid grid-cols-2 gap-2 lg:hidden"
          data-dex-faded={dexExpanded ? "true" : "false"}
          data-testid="desk-kpi-strip"
        >
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
            /* ASK-52 · the fourth pill is the boards, not the ledger. It
               carries the desktop card's headline number and nothing else
               the card carries: how many cards need attention, out of how
               many are running — the same workflowAttention() the tile
               reads, so the phone and the desktop cannot disagree. The
               you/stuck/late split, the Next up card and its move stay on
               the desktop: a pill has no room for them, and no room for a
               button inside something that is itself a link. Net profit
               keeps its home on /finance, where this pill used to go.
               RETIRED TESTID: kpi-profit-m (no test referenced it). */
            { icon: FlowArrow, label: "Workflows",
              value: workflowsQ.isLoading ? "…" : String(wfAttention.needAttention),
              sub: workflowsQ.isLoading ? null : `/${wfAttention.total}`,
              urgent: wfAttention.needAttention > 0,
              to: "/workflows", testid: "kpi-workflows-m" },
          ].map((k) => (
            /* ASK-42 A — p-2.5 below lg (p-3 from lg up): 4px off each tile is
               8px off the strip, and the strip is two rows deep. */
            <Link key={k.testid} to={k.to} data-testid={k.testid}
              className="flex min-w-0 items-center justify-between gap-2 rounded-[1.1rem] bg-white/75 p-2 lg:p-3 ring-1 ring-inset ring-white/80 shadow-[0_8px_22px_-14px_hsl(150_15%_20%/0.3)] backdrop-blur-xl">
              <p className="min-w-0 truncate text-xs font-medium text-foreground/80">{k.label}</p>
              <span className="flex shrink-0 items-center gap-1.5">
                <k.icon size={13} weight="regular" aria-hidden="true" className="text-muted-foreground" />
                {/* The number, and — where a pill has one — the total it
                    is out of, in the desktop tile's own shape. */}
                <span className="inline-flex items-baseline">
                  <span className={`font-display text-base leading-none tabular-nums ${k.urgent ? "text-kr-accent" : ""}`}>
                    {k.value}
                  </span>
                  {k.sub && (
                    <span className="ml-0.5 text-[11px] font-medium leading-none tabular-nums text-muted-foreground">
                      {k.sub}
                    </span>
                  )}
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
        {/* ASK-52 — still three columns and two rows; the second row is the
            two-wide Workflows card plus one tile. */}
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
            icon={HandCoins}
            alert={(m.cash?.overdue || 0) > 0}
            label="To collect (overdue)"
            value={m.cash ? inrCompact(m.cash.overdue) : "…"}
            urgent={(m.cash?.overdue || 0) > 0}
            to="/finance?tab=revenue&filter=overdue"
            testid="kpi-collect"
          />
          {/* ASK-52 — THE WORKFLOWS CARD, TWO CELLS WIDE, where Weakest and Net
              profit were. The grid reflows around it: the three tiles that can
              raise the alert dot (Delayed, Complaints, To collect) take the top
              row, and this sits under them beside the one quiet money number.
              Its numbers come from workflowAttention, which the Workflows page
              can read later without the two disagreeing. */}
          <WorkflowsTile
            attention={wfAttention}
            loading={workflowsQ.isLoading}
            className="lg:col-span-2"
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
      {/* ASK-48 — AND THEY TRADE PLACES AGAIN. ASK-46 sent Dex to the foot of
          the page and gave the card its old seat under the tiles; the founder
          has looked at that on a phone and wants it the other way round —
          "move the dex well on top of the black card and move the black card
          below the dex well". So the well is the middle of the screen, where a
          thumb rests and where a mic the size of this one belongs, and the
          card is the last thing above the dock. Only the ORDER changes: the
          well still takes whatever height is left over (flex-1) and the card
          is still the fixed three rows it has been since ASK-46. */}
      {isMobile && dexWell}

      {/* ASK-47 — NOTHING ELSE MOVES. The card goes `position: fixed` when it
          pops, which takes it out of the page's column; this holds its place at
          exactly the height it had, so the tiles above and Dex — now above it —
          stay where the founder left them. Without it the page would reflow the
          moment the card lifted, which is the one thing this rearrangement is
          not allowed to do. */}
      {pop && <div aria-hidden="true" style={{ height: pop.rest.height }} data-testid="desk-board-spacer" />}
      {/* THE PAGE BEHIND IT, dimmed and blurred — subtly, both. It sits under
          the card (9001) and under the dock (10000), so the bar keeps its own
          material and its own sharpness: the blur only ever touches what is
          BEHIND the backdrop, and the dock is not. Tapping it closes the card,
          which is the gesture every other layer in this app answers to. */}
      {pop && (
        <div
          data-testid="desk-board-scrim"
          onClick={() => setPhoneExpanded(false)}
          aria-hidden="true"
          className="fixed inset-0 z-[9000] bg-kr-ink/[0.10] backdrop-blur-[3px] transition-opacity duration-[260ms] lg:hidden"
          style={{ opacity: pop.at === "full" ? 1 : 0 }}
        />
      )}
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
        /* ASK-35 3.1-3.3 — THE BOARD DETACHES.
           `lg:-mb-8` is gone: it existed to pull the black through the content
           wrapper's 2rem bottom padding and off the floor, and it is a card
           now. `lg:-mb-2` in its place is EVEN SPACING, not a guess: the gap
           ABOVE the board is desk-page's own `gap-6`, 1.5rem; below it the
           wrapper leaves 2rem; pulling back 0.5rem makes the visible gap
           2 - 0.5 = 1.5rem and the two match exactly. Measured at 1280 and
           1440, not eyeballed.
           `lg:-mx-3` pushes it 12px past the well's left edge and the KPI
           grid's right — enough to read as a wider plane than the content on
           it, and 12 of the wrapper's 32px of padding, so it can never reach
           the page edge. */
        /* ASK-39 1 — `max-lg:grid-rows-[minmax(0,1fr)]` is what makes the
           sheet take the page's remaining height rather than its content's.
           The board is a GRID, so the phone card's own `flex-1` is inert on it:
           a grid item is sized by its row, and an auto row is never shrunk
           below its content. It is the same fix ASK-34 7.2 made at lg, for the
           same reason, one breakpoint down. */
        ref={boardRef}
        /* ASK-47 — THE SAME CARD, LIFTED. When it pops it is this element that
           goes `position: fixed` — not a copy of it in a portal — so the tabs
           the founder was looking at, the row they were reading and the card's
           own material all survive the transition, because they never left.
           `data-popped` is what the page reads to dim behind it. */
        data-popped={pop?.at === "full" ? "true" : undefined}
        style={pop ? {
          position: "fixed",
          zIndex: 9001,
          left: pop[pop.at].left,
          top: pop[pop.at].top,
          width: pop[pop.at].width,
          height: pop[pop.at].height,
          transition: `top ${POP_MS}ms cubic-bezier(.22,1,.36,1), height ${POP_MS}ms cubic-bezier(.22,1,.36,1)`,
        } : undefined}
        className={cn(
          "kr-desk-board grid gap-5 lg:-mx-3 lg:-mb-2 lg:min-h-0 lg:flex-1 lg:gap-0 lg:grid-rows-[minmax(0,1fr)]",
          showDecisions && "lg:grid-cols-[calc((100%-5rem)*29/74+2.5rem)_minmax(0,1fr)]",
          // Popped, the card is a column: tab strip on top, list filling the rest.
          pop && "max-lg:grid-rows-[minmax(0,1fr)]"
        )}
      >
        {/* ASK-34 B — THE PHONE'S CARD. One card, three tabs, the same rows the
            desktop columns use. */}
        {isMobile && (
        <PhoneTabCard
          tone={phoneTab === "decisions" ? "needs" : phoneTab === "approvals" ? "flag" : "today"}
          testid="desk-phone-card"
          tabs={phoneTabs}
          tab={phoneTab}
          onTab={setPhoneTab}
          open={!!pop}
          scrolls={pop?.at === "full"}
          onToggleExpanded={() => setPhoneExpanded((v) => !v)}
          loading={phoneTab === "decisions" ? decisionsLoading : phoneTab === "approvals" ? !m.tasks : false}
          empty={phoneTab === "decisions" ? SECTIONS[0].empty : "Nothing waiting for your sign-off"}
          rows={phoneTab === "decisions" ? decisionRows : phoneTab === "approvals" ? approvalRows : []}
        >
          {/* Watch is three feeds, not a list of rows: they keep the cards they
              already had, which are links to the pages that hold the detail. */}
          {phoneTab === "watch" ? (
            <div className="flex flex-col gap-2.5" data-testid="desk-watch">
              <StackCard
                tone="today"
                title="Due today"
                count={counters ? counters.due_today : null}
                loading={boardQs[2]?.isLoading}
                line={todayCards[0]?.title}
                empty={SECTIONS[2].empty}
                to="/my-work?filter=due_today"
                testid="desk-due-today-m"
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
                  /* ASK-51 — MY WORK'S APPROVALS, NOT THE APPROVALS PAGE. The founder:
                      this card opened /approvals?sub=leave, and the page they want
                      is the one My Work's own approvals section opens. `sub=leave`
                      stays on THIS url so a card that says "Leave requests" opens
                      the Leave tab rather than an empty Tasks one; it is the same
                      page either way. */
                  to="/my-work?view=approvals&sub=leave"
                  testid="desk-leave-m"
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
                testid="desk-slipping-m"
              />
            </div>
          ) : null}
        </PhoneTabCard>
        )}

        {!isMobile && showDecisions && (
          <DeskCard
            tone="needs"
            title="Decisions"
            count={decisionCount}
            /* ASK-40 3 — the note follows the order. It said "longest waiting
               first", which is what desk.py still sends; newestFirst() turns
               that round on the way in, so the heading has to say the new
               truth. "What each unblocks" is in the context line but is still
               not the order (ASK-25 open question 1). */
            note="newest first"
            loading={decisionsLoading}
            empty={SECTIONS[0].empty}
            rows={decisionRows}
            moreSuffix=" waiting"
            cta={topDecision ? "Review" : null}
            onCta={() => topDecision && setOpenDecisionId(topDecision.target_id)}
            scroll
            testid="desk-decisions"
            /* ASK-34 B — the three columns are the DESKTOP card now; below lg the
               same rows are in the tabbed card above. */
            className="lg:border-r lg:border-white/[.14] lg:pr-5"
          />
        )}

        {/* The same row cap again — this nested grid is itself a grid item, so
            without it Task approvals would push the board open on its own. */}
        {!isMobile && (
        <div className={`grid min-w-0 gap-5 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)] ${showDecisions ? "lg:pl-5" : ""} ${showApprovals ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-0" : ""}`}>
          {showApprovals && (
            <DeskCard
              tone="flag"
              title="Task approvals"
              count={approvalsQ.data ? approvals.length : null}
              loading={!m.tasks}
              empty="Nothing waiting for your sign-off"
              rows={approvalRows}
              cta="Approvals"
              /* The pill goes to My Work's Approvals view on MY approvals. */
              onCta={() => navigate("/approvals?scope=mine")}
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
        )}
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
