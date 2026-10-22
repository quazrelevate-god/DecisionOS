/* ASK-52 · THE WORKFLOWS TILE — a member of the Desk's KPI grid, two cells wide.
 *
 * It is the same tile as the five beside it, not a new thing: nm-tile's white
 * rounded face, IconChip top-left wearing the alert dot on the same rule as
 * Delayed and To collect, the black circular arrow top-right, the same label
 * and the same BigNumeral. What it adds is the width: the left half counts
 * what needs attention across every board, the right half names the one card
 * to pick up, and one button opens that card on its board.
 *
 * FIX-3 (2026-10-21, founder) — NO MOVE ON THE DESK, ONE WAY IN. The tile used
 * to carry the board's own move as well: "Approve" under the left half and
 * "Open Workflows" under the right, while everything the move was about sat on
 * the right. The client could not tell which button belonged to the card. And
 * approving from here meant signing off a stage from a title and a chip, never
 * having seen the card. So the move is gone: "Open in Workflows" runs the
 * tile's full width, opens the board on the card the tile names
 * (/workflows?wf=…&wf_type=…), and the board glows that card — where the whole
 * card can be read and moved on.
 *
 * The numbers are workflowAttention's (pages/desk/workflowAttention.js); this
 * file only draws them.
 */
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, FlowArrow } from "@phosphor-icons/react";
import { BigNumeral } from "../../components/neuglass";
import { IconChip } from "../../components/neuglass/IconChip";
import { CHIP } from "../../components/neuglass/glass";
import { cn } from "../../lib/utils";
import { useIsMobile } from "../../hooks/useIsMobile";

/* The bar's three parts, in the order the founder wrote them: you, stuck,
   late — the app's ink, its amber and its accent. A card is in exactly one, so
   the three widths are a split of the number above them. */
const PARTS = [
  { key: "you", label: "you", bar: "bg-neutral-900", dot: "bg-neutral-900" },
  { key: "stuck", label: "stuck", bar: "bg-amber-400", dot: "bg-amber-400" },
  { key: "late", label: "late", bar: "bg-ng-accent", dot: "bg-ng-accent" },
];

/* The button's recipe: one fixed height, no taller than the platform's 44pt
   target once --ui-scale's 0.8 lands, the label on one line and centred. */
/* DEX-R1 audit (2026-10-08) — 13px is 10.4pt once the phone's 0.8 lands,
   under HIG's 11pt floor; 15px is 12pt. Desktop keeps 13. */
const ACTION_PILL =
  "flex h-10 max-lg:h-[3.5rem] w-full shrink-0 items-center justify-center gap-1.5 rounded-pill px-2.5 lg:px-4 "
  + "text-center text-[13px] max-lg:text-[15px] font-medium leading-tight "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ng-outline";

/* FIX-3 — the tile's one action, so it wears the ink: HIG (buttons › Style)
   gives the prominent style to the most likely action, and it is the only one. */
const PILL_INK = "bg-[hsl(var(--ng-action-bg,var(--ng-ink)))] text-[hsl(var(--ng-action-fg,0_0%_100%))]";

/* FIX-3 — where the button goes: the board, opened on the card the tile names
   (Workflows.js reads ?wf= and ?wf_type=: it switches to that board, opens the
   card's stage, brings it into view and glows it). With no card named, the
   board itself. */
export function boardLinkFor(nextUp) {
  if (!nextUp?.id) return "/workflows";
  return `/workflows?wf=${encodeURIComponent(nextUp.id)}${nextUp.type ? `&wf_type=${encodeURIComponent(nextUp.type)}` : ""}`;
}

/* THE WIDE ARRANGEMENT'S WAY IN IS A CIRCLE, not a pill — the founder's call:
   in a 255px column a labelled pill took the room the card's name needed.

   THE VISIBLE LABEL GOES, THE ACCESSIBLE ONE DOES NOT. accessibility.md is
   explicit that an icon-only control still needs a name for a screen reader, so
   it carries the pill's words — "Open in Workflows" — as aria-label and as the
   hover title. 3.5rem is 44.8 real pixels once --ui-scale's 0.8 lands, which
   is the platform's target. */
const ICON_MOVE =
  "grid h-14 w-14 shrink-0 place-items-center rounded-full "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ng-outline";

const REASON_CHIP = {
  stuck: "bg-amber-50 text-amber-800 ring-amber-100",
  late: "bg-rose-50 text-rose-700 ring-rose-100",
  you: "bg-slate-500/[0.07] text-slate-700 ring-slate-500/10",
};

/* `wide` — the card owns a whole row instead of two of three columns.
   Proposed by the founder after seeing the Desk on a real iPhone 13 mini, where
   "Spend, this month" was a tall near-empty tile with its own label truncated to
   "Spend, this…". Dropping it frees a column; this card takes it and comes down
   to the top row's height. More width, less height — so the two moves go side by
   side instead of stacking, which is where the height comes from. */
export function WorkflowsTile({ attention, loading = false, className, wide = false, testid = "kpi-workflows" }) {
  const phone = useIsMobile();
  const { needAttention = 0, total = 0, nextUp = null, advancedToday = 0, atRisk = 0 } = attention || {};
  const quiet = !loading && needAttention === 0;

  const parts = PARTS.map((p) => ({ ...p, n: attention?.[p.key] || 0 })).filter((p) => p.n > 0);
  // The card the tile names, if it names one: the button opens the board on it.
  const boardLink = boardLinkFor(!loading && !quiet ? nextUp : null);

  /* FIX-3 — the tile's one button, the full width of the tile and centred,
     under both halves (the phone and desktop bodies place it). */
  const openBoard = (place) => (
    <Link to={boardLink} data-testid={`${testid}-open`} className={cn(ACTION_PILL, PILL_INK, place)}>
      <span className="whitespace-nowrap">Open in Workflows</span>
      <ArrowRight size={14} weight="bold" aria-hidden="true" className="ng-arrow hidden shrink-0 transition-transform duration-200 lg:block" />
    </Link>
  );

  /* THE WIDE ARRANGEMENT — a proposal, rendered only in /design-lab behind
     ?kpi=wide (Desk.js). It is a SEPARATE BODY rather than the tall card with
     tighter classes, and that is the point: squeezing the tall one into the top
     row's height just made it overflow and disappear behind the black card.
     A card that is twice as wide and half as tall is a different arrangement —
     the count sits beside its label instead of under it, and the two moves go
     side by side instead of stacking. Everything it shows, it shows from the
     same values; nothing new is computed and nothing is dropped except the
     "forecast to miss" line, which has no row to live on at this height and is
     the one piece here that is not about right now.
     If the founder says no, deleting this block restores the card exactly. */
  if (wide) {
    return (
      <div
        data-testid={testid}
        /* 2026-10-05 (founder) — THE LABEL IS GONE AND THE NUMBER TAKES ITS
           PLACE. "Remove the sentence that contains Workflows — need attention
           on the left; instead increase the font size of the number and align
           it in the same row where the icon is, and make space for the right
           side content by moving the separator to the left a little."
           The sentence was wrapping to two lines on a phone and still arriving
           truncated ("Workflows — need…"), so it was costing two rows to say
           less than the icon does. The flow glyph names the card, the numeral
           answers it, and the right-hand half — which carries the actual stuck
           card and its move — gets the width back: 0.85fr/1.6fr becomes
           0.6fr/1.9fr, which is the separator stepping left. */
        className={cn("ng-stat nm-tile grid grid-cols-[minmax(0,0.6fr)_1px_minmax(0,1.9fr)] items-center gap-3 p-3", className)}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <IconChip icon={FlowArrow} alert={needAttention > 0} />
          <div className="min-w-0">
            <span className="flex items-baseline whitespace-nowrap leading-none">
              <BigNumeral text={loading ? "…" : String(needAttention)} size="lg"
                className={quiet ? "text-foreground/45" : undefined}
                accent={!quiet && !loading} testid={`${testid}-count`} />
              {!loading && <span className="ml-1 text-base font-medium text-muted-foreground">/ {total}</span>}
            </span>
            {!loading && !quiet && parts.length > 0 && (
              <span className="mt-1 block" data-testid={`${testid}-split`}>
                <span className="flex h-1.5 w-full max-w-[9rem] overflow-hidden rounded-full bg-slate-900/[0.06]">
                  {parts.map((pt) => (
                    <span key={pt.key} className={pt.bar} style={{ width: `${(pt.n / needAttention) * 100}%` }} />
                  ))}
                </span>
              </span>
            )}
          </div>
        </div>

        <span aria-hidden="true" className="h-full w-px self-stretch bg-slate-900/10" />

        <div className="flex min-w-0 flex-col justify-center gap-1.5">
          {loading ? (
            <div className="space-y-2" aria-hidden="true">
              <div className="ds-skeleton h-3.5 w-24 rounded-control" />
              <div className="ds-skeleton h-8 w-4/5 rounded-control" />
            </div>
          ) : quiet ? (
            <div className="flex min-w-0 items-center justify-between gap-2.5">
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-emerald-700" data-testid={`${testid}-quiet`}>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <span className="min-w-0 truncate">All moving{advancedToday > 0 ? ` · ${advancedToday} advanced today` : ""}</span>
              </p>
              <Link
                to={boardLink}
                data-testid={`${testid}-open`}
                title="Open in Workflows"
                aria-label="Open in Workflows"
                className={cn(ICON_MOVE, PILL_INK)}
              >
                <ArrowUpRight size={22} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          ) : nextUp ? (
            /* The title gets the room a pill would hold, and gets to use two
               lines of it — this is the name of the thing waiting on the
               founder, and an ellipsis in the middle of it is the whole reason
               this arrangement is being tried. */
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground"
                   title={nextUp.title} data-testid={`${testid}-next-title`}>
                  {nextUp.title}
                </p>
                <span className={cn(CHIP, "mt-1 inline-flex max-w-full truncate", REASON_CHIP[nextUp.reason] || REASON_CHIP.you)}
                      title={nextUp.reasonLabel} data-testid={`${testid}-next-reason`}>
                  {nextUp.reasonLabel}
                </span>
              </div>
              <Link
                to={boardLink}
                data-testid={`${testid}-open`}
                title="Open in Workflows"
                aria-label="Open in Workflows"
                className={cn(ICON_MOVE, PILL_INK)}
              >
                <ArrowUpRight size={22} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            /* Nothing waiting: the boards are still one tap away, on their own. */
            <div className="flex min-w-0 items-center justify-between gap-2.5">
              <p className="min-w-0 text-sm text-muted-foreground">Nothing waiting on a move.</p>
              <Link
                to={boardLink}
                data-testid={`${testid}-open`}
                title="Open in Workflows"
                aria-label="Open in Workflows"
                className={cn(ICON_MOVE, PILL_INK)}
              >
                <ArrowUpRight size={22} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* THE PHONE'S OWN ARRANGEMENT (2026-10-13, founder): "uncluttered — remove
     the elements marked … and re-arrange to make the tile feel fuller but
     spacious". What went: the "N cards forecast to miss their target date"
     line, the "3 you" legend, the NEXT UP eyebrow, "Workflows —" from the
     label (a screen reader still hears it) and — third pass, 2026-10-14 — the
     bar under the count: "3 / 13 is itself enough". What is left is two halves
     either side of one separator:
       · LEFT, only as wide as what is in it — the count beside the icon, and
         "Need attention" on one line;
       · RIGHT, everything else — the card's chip, name and where it stands.
     FIX-3 (2026-10-21): and under both, the tile's one button, "Open in
     Workflows", the tile's full width — the Approve that sat under the left
     half is gone (see the top of this file). The separator now stops at the
     halves.
     A separate body rather than max-lg: classes on the desktop one, the way
     `wide` is: desktop keeps every pixel it had, and this can change without
     touching it. Same values, same test ids. */
  if (phone) {
    return (
      <div data-testid={testid} className={cn("ng-stat nm-tile", className)}>
        <div className="grid grid-cols-[auto_1px_minmax(0,1fr)] grid-rows-[1fr_auto] gap-x-5 gap-y-3">
          <div className="col-start-1 row-start-1 flex min-w-0 flex-col">
            <div className="flex items-center gap-2.5">
              <IconChip icon={FlowArrow} alert={needAttention > 0} />
              <span className="inline-flex items-baseline whitespace-nowrap leading-none">
                <BigNumeral text={loading ? "…" : String(needAttention)} size="md"
                  className={quiet ? "text-foreground/45" : undefined}
                  accent={!quiet && !loading} testid={`${testid}-count`} />
                {!loading && <span className="ml-1 text-lg font-medium text-muted-foreground">/ {total}</span>}
              </span>
            </div>
            <p className="ng-stat__label mt-2.5 whitespace-nowrap text-base text-foreground/80">
              <span className="sr-only">Workflows — </span>Need attention
            </p>
          </div>

          <span aria-hidden="true" className="col-start-2 row-start-1 w-px self-stretch bg-slate-900/10" />

          <div className="col-start-3 row-start-1 flex min-w-0 flex-col">
            {loading ? (
              <div className="space-y-2" aria-hidden="true">
                <div className="ds-skeleton h-6 w-28 rounded-pill" />
                <div className="ds-skeleton h-4 w-4/5 rounded-control" />
                <div className="ds-skeleton h-4 w-3/5 rounded-control" />
              </div>
            ) : quiet ? (
              <p className="my-auto flex items-center gap-2 text-sm font-medium text-emerald-700" data-testid={`${testid}-quiet`}>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                All moving{advancedToday > 0 ? ` · ${advancedToday} advanced today` : ""}
              </p>
            ) : nextUp ? (
              <>
                {/* The words in their own span: `truncate` on the chip itself
                    clips (it is a flex box) — the span is what can end in "…". */}
                <span className={cn(CHIP, "min-w-0 max-w-full shrink self-start py-1 text-[14px]", REASON_CHIP[nextUp.reason] || REASON_CHIP.you)}
                      title={nextUp.reasonLabel} data-testid={`${testid}-next-reason`}>
                  <span className="min-w-0 truncate">{nextUp.reasonLabel}</span>
                </span>
                <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground" title={nextUp.title} data-testid={`${testid}-next-title`}>
                  {nextUp.title}
                </p>
                <p className="mt-auto truncate pt-1 text-[14px] text-muted-foreground" title={`${nextUp.stage}${nextUp.note ? ` · ${nextUp.note}` : ""}`}>
                  {nextUp.stage}{nextUp.note ? ` · ${nextUp.note}` : ""}
                </p>
              </>
            ) : (
              <p className="my-auto text-sm text-muted-foreground">Nothing waiting on a move.</p>
            )}
          </div>

          {openBoard("col-span-3 row-start-2 px-4")}
        </div>
      </div>
    );
  }

  return (
    /* 2026-09-21, founder — THE NEXT UP HALF RUNS FROM THE CARD'S TOP EDGE:
       it used to start under a header row whose only job on this side was the
       black arrow. FIX-3 (2026-10-21): the move that sat at its foot is gone,
       and "Open in Workflows" runs under both halves (see the top of this
       file). */
    <div
      data-testid={testid}
      className={cn(
        /* max-lg: — the phone runs this same tile, scaled (Desk's PHONE_TILE).
           The 20px gutter and the 170px floor are desktop's; on a 487px CSS
           viewport two columns plus a 20px trough leaves too little for the
           "next up" title, so the trough halves and the floor comes off. */
        "ng-stat nm-tile grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] gap-5 p-5",
        /* 2026-10-06 (founder) — ON A PHONE THE SEPARATOR STEPS LEFT. Down the
           middle it gave both halves 164px, and the two sides do not need the
           same: the left is a fixed label, a count and a bar — "it is static in
           terms of showing characters" — while the right carries a workflow's
           own title, which is as long as the customer's name. 1 : 1.35 leaves
           the left column wide enough for "Workflows — need" on one line with
           room after it (the founder: "don't be so near to the text") and hands
           the difference to the title beside it. Desktop keeps its even split —
           there the tile is twice as wide and neither side is short. */
        "max-lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1.35fr)]",
        "max-lg:gap-2.5 lg:min-h-[170px]",
        wide && "max-lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1.45fr)]", className)}
    >
      {/* LEFT — the count, and what it is made of. The chip wears the dot
          whenever something needs attention (Delayed and To collect's rule). */}
      <div className="flex min-w-0 flex-col">
        <IconChip icon={FlowArrow} alert={needAttention > 0} />
        <p className="ng-stat__label mt-4 text-base text-foreground/80">Workflows — need attention</p>
        {/* 2026-09-22 — on time today, but forecast to miss the date the card
            has to be done by (services/workflow_timing). Not late yet, so not
            one of the three reasons; said here so it is seen before it is. */}
        {!loading && atRisk > 0 && (
          <p className="mt-1 text-[12px] font-medium text-amber-700" data-testid={`${testid}-at-risk`}>
            {atRisk === 1 ? "1 card" : `${atRisk} cards`} forecast to miss {atRisk === 1 ? "its" : "their"} target date
          </p>
        )}
        <div className="ng-stat__foot mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-3">
          <span className="inline-flex shrink-0 items-baseline whitespace-nowrap leading-none">
            {/* The score's own shape: the number, then the total it is out of. */}
            <BigNumeral text={loading ? "…" : String(needAttention)} size="md"
              className={quiet ? "text-foreground/45" : undefined}
              accent={!quiet && !loading} testid={`${testid}-count`} />
            {!loading && (
              <span className="ml-1 text-lg font-medium text-muted-foreground">/ {total}</span>
            )}
          </span>
          {!loading && !quiet && parts.length > 0 && (
            <span className="min-w-0 pb-0.5 text-right" data-testid={`${testid}-split`}>
              <span className="ml-auto flex h-1.5 w-[140px] max-w-full overflow-hidden rounded-full bg-slate-900/[0.06]">
                {parts.map((p) => (
                  <span key={p.key} className={p.bar} style={{ width: `${(p.n / needAttention) * 100}%` }} />
                ))}
              </span>
              {/* 11px was 8.8pt on a phone. 14px is the 11pt floor; and if the
                  three parts ever outgrow the column they wrap between parts,
                  never inside one ("1 / stuck"). */}
              {/* On a phone the bar fills the column, so its legend starts
                  where the bar starts (layout › align to scan); desktop's
                  140px bar sits right, and its legend with it. */}
              <span className="mt-1.5 flex flex-wrap justify-start gap-x-1 text-[14px] leading-[18px] text-muted-foreground lg:justify-end lg:text-[12px] lg:leading-none">
                {parts.map((p, i) => (
                  <span key={p.key} className="whitespace-nowrap">{i > 0 ? "· " : ""}{p.n} {p.label}</span>
                ))}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* A hairline between the two halves, as the drawer's sections use. */}
      <span aria-hidden="true" className="w-px self-stretch bg-slate-900/10" />

      {/* RIGHT — the one to pick up (or the quiet line). */}
      <div className="flex min-w-0 flex-col">
        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            <div className="ds-skeleton h-3.5 w-24 rounded-control" />
            <div className="ds-skeleton h-4 w-4/5 rounded-control" />
          </div>
        ) : quiet ? (
          /* Nothing is asking for anything. It should read as a good state,
             not as an empty one. */
          <p className="mt-auto flex items-center gap-2 text-sm font-medium text-emerald-700" data-testid={`${testid}-quiet`}>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            All moving{advancedToday > 0 ? ` · ${advancedToday} advanced today` : ""}
          </p>
        ) : nextUp ? (
          <>
            {/* The eyebrow and the reason share a line, so the card's name
                and its stage each keep a line of their own. */}
            {/* THE CHIP WRAPS UNDER THE EYEBROW WHEN THE COLUMN IS NARROW.
                `shrink-0` beside a `justify-between` eyebrow is fine at the
                desktop width this was written for; on the phone the column is
                103px and "Needs your sign-off" ran 28px PAST the tile's own
                edge (measured, sparse fixture). flex-wrap lets it drop to its
                own line, and min-w-0 + truncate means even a longer reason can
                only ever use the width it has. */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
              {/* Eyebrow and chip were 11px — 8.8pt on a phone, the smallest
                  type on the Desk. Both now clear the 11pt floor there. */}
              <p className="shrink-0 text-[14px] font-semibold uppercase tracking-[0.12em] text-slate-500 lg:text-[12px]">Next up</p>
              <span className={cn(CHIP, "min-w-0 max-w-full truncate max-lg:py-1 max-lg:text-[14px]", REASON_CHIP[nextUp.reason] || REASON_CHIP.you)}
                    title={nextUp.reasonLabel} data-testid={`${testid}-next-reason`}>
                {nextUp.reasonLabel}
              </span>
            </div>
            {/* J14-09 (JOURNEY-1) — THE ONE THING HE HAS TO SIGN OFF, CUT IN HALF.
                One line and an ellipsis: "Second press brake — Coimbat…", on the
                card that asks for his approval. There is room underneath — the
                Requested line and two buttons sit below it — so this was a clamp,
                not a space problem. Two lines, then clamp: a long title reads,
                and the tile still cannot grow without limit. */}
            <p className="mt-1.5 line-clamp-2 text-sm font-medium text-foreground" title={nextUp.title} data-testid={`${testid}-next-title`}>
              {nextUp.title}
            </p>
            <p className="mt-1 truncate text-[14px] text-muted-foreground lg:text-xs" title={`${nextUp.stage}${nextUp.note ? ` · ${nextUp.note}` : ""}`}>
              {nextUp.stage}{nextUp.note ? ` · ${nextUp.note}` : ""}
            </p>
          </>
        ) : (
          <p className="mt-auto text-sm text-muted-foreground">Nothing waiting on a move.</p>
        )}

      </div>

      {/* FIX-3 — the tile's one button, under both halves, the tile's width. */}
      {openBoard("col-span-3")}
    </div>
  );
}

export default WorkflowsTile;
