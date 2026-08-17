/**
 * Ops — the mobile Operating Score.
 *
 * Two layers, and the split is the whole idea:
 *
 *   The hero is `fixed`. It does not scroll, it does not shrink, it does not
 *   collapse into a bar. It holds the one number the page exists to report and
 *   the four that explain it, and it is the same on first paint and after the
 *   list has been scrolled to the bottom.
 *
 *   The sheet is pinned over it with rounded top corners and its own surface,
 *   and SCROLLS INTERNALLY. Nothing animates it and nothing needs to — the
 *   scroll is the motion, which is what "quiet" buys: no parallax, no fade, no
 *   header that morphs on a threshold. (See the longer note at the sheet for
 *   why it is pinned rather than sliding up with the page.)
 *
 * The hero is a chart, not a stat block, because the reading is comparative:
 * "is this number good, and which of the four is dragging it". A radial gauge
 * answers the first at a glance and the four tracks answer the second, in one
 * viewport, with no interaction. The company counters sit under it in the same
 * glass, because they are the totals the per-person grid below sums to.
 *
 * Colour: the hero is monochrome by design. The arc and the bars are fixed
 * translucent white and only the NUMBERS carry a band colour — a red arc plus
 * four coloured bars made the score's own hue change with the data and turned
 * the whole panel into an alarm.
 *
 * Chrome: the top bar is overlaid by Layout (IMMERSIVE_MOBILE_ROUTES) so the
 * logo and the bell sit on the hero rather than above a seam. The dock and the
 * Dex FAB are untouched — they are `fixed` at z-[10000] and were never in this
 * flow, so every layer here stays well below that.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import { cn } from "@/lib/utils";
import {
  Lightning, CurrencyCircleDollar, TrendUp, ChatCenteredDots,
} from "@phosphor-icons/react";
import { AccessSheet, InviteSheet, MemberCard, useTeamData } from "../../components/mobile";

const CATS = [
  { key: "execution", label: "Execution", icon: Lightning },
  { key: "finance", label: "Finance", icon: CurrencyCircleDollar },
  { key: "sales", label: "Sales", icon: TrendUp },
  { key: "responsiveness", label: "Response", icon: ChatCenteredDots },
];

const roleLabel = (r) => (r ? String(r).replace(/^./, (c) => c.toUpperCase()) : "");

// The three colour ramps this screen used to band by — a stroke ramp for the
// arc, a 400-step text ramp for the hero, a 600-step one for the sheet — are
// all gone. The screen is monochrome: white at varying opacity on the hero,
// foreground at varying opacity in the sheet. Rank, size and position carry the
// reading now, and the urgency colours are left to the surfaces that act on
// them (the Desk's fires, a member's overdue count in their own card).

const R = 52;                      // gauge radius
const C = 2 * Math.PI * R;         // circumference, for the dash offset
const GAUGE = 124;                 // box side. Sized so the gauge PLUS its
                                   // caption comes out level with the category
                                   // pane beside it — the row is centred, so if
                                   // one column is much shorter the whole thing
                                   // reads as lopsided.

// The hero is one glass material: translucent white fill, a lighter hairline to
// catch the "edge", and no colour of its own. Everything floating on the dark
// uses this so the section reads as a single pane rather than five widgets.
const GLASS = "bg-white/[0.07] border border-white/[0.12] backdrop-blur-md";

/**
 * The overall score as a swept arc.
 *
 * Deliberately NOT colour-banded. It used to turn red below 40 and green above
 * 70, which meant the hero's largest element changed hue with the data and
 * fought the glass it sits in — a 33 painted the whole screen as an alarm. The
 * arc and the number are now fixed translucent white; the score is the size it
 * is, and the categories below say which part is weak. Motion still runs once.
 */
function Gauge({ value, armed }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="shrink-0 flex flex-col items-center">
      <div className="relative" style={{ width: GAUGE, height: GAUGE }}>
        <svg width={GAUGE} height={GAUGE} viewBox={`0 0 ${GAUGE} ${GAUGE}`} className="-rotate-90">
          <circle cx={GAUGE / 2} cy={GAUGE / 2} r={R} fill="none" strokeWidth="10" className="stroke-white/[0.10]" />
          <circle
            cx={GAUGE / 2} cy={GAUGE / 2} r={R} fill="none" strokeWidth="10" strokeLinecap="round"
            className="stroke-white/70 transition-[stroke-dashoffset] duration-[900ms] ease-out motion-reduce:transition-none"
            strokeDasharray={C}
            // Held at empty for the first frame so the sweep has somewhere to
            // travel from; `armed` flips on the next tick.
            strokeDashoffset={armed ? C - (pct / 100) * C : C}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-heading text-[38px] font-black leading-none tabular-nums text-white/90"
            data-testid="ops-overall-score"
          >
            {value == null ? "—" : value}
          </span>
          <span className="label-mono text-white/40 mt-0.5">/ 100</span>
        </div>
      </div>
      {/* The dial had no name. The four categories beside it are all labelled,
          so the one unlabelled thing was the number the screen is about. */}
      <span className="label-mono text-white/45 mt-1.5 whitespace-nowrap" data-testid="ops-score-caption">
        Operating score
      </span>
    </div>
  );
}

/**
 * One category: label, value, and a track that grows with the others.
 *
 * The bar is translucent white for the same reason the arc is — four bars in
 * three different hues was the noisiest thing on the screen. The VALUE keeps
 * its band colour, so the reading survives: the number tells you good or bad,
 * the bar tells you how far along, and only one of those needs to shout.
 */
function CatTrack({ cat, value, armed, index }) {
  const has = value != null;
  return (
    <div data-testid={`ops-cat-${cat.key}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/60">
          <cat.icon size={13} weight="bold" /> {cat.label}
        </span>
        <span className="font-heading text-sm font-black tabular-nums text-white/90">
          {has ? value : "—"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.10] overflow-hidden">
        <div
          className="h-full rounded-full bg-white/70 transition-[width] duration-700 ease-out motion-reduce:transition-none"
          // Staggered behind the gauge so the hero resolves in one settling
          // gesture rather than four things starting at once.
          style={{ width: armed && has ? `${value}%` : "0%", transitionDelay: `${140 + index * 70}ms` }}
        />
      </div>
    </div>
  );
}

/** A company counter, as a glass tile on the hero rather than a card in the sheet. */
function HeroCounter({ label, value }) {
  return (
    <div className={cn("rounded-xl px-1 py-1.5 text-center", GLASS)}>
      <p className="font-heading text-base font-black leading-none tabular-nums text-white/90">{value}</p>
      <p className="label-mono mt-1 text-[9px] tracking-normal text-white/45">{label}</p>
    </div>
  );
}

export default function OpsMobile() {
  const { data, isLoading } = useQuery({
    queryKey: ["operating-score"],
    queryFn: () => api.get("/operating-score").then((r) => r.data),
  });

  // The screen is named Ops in the nav and the All Apps tile; the tab is the
  // third place a name shows. PageHeader can't carry it — it ignores `title`
  // and renders only `children` — so it is set here, as DeskMobile does.
  useEffect(() => { document.title = "Ops · DecisionOS"; }, []);

  // One-shot arming for the entry motion. Not a loop, not scroll-linked.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (isLoading || !data) return;
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, [isLoading, data]);

  // Team management, now that the roster lives on this screen rather than
  // behind its own menu entry. Same hook the Team screen uses.
  const {
    members, absentIds, isOwner, canManageTeam, roleOptions,
    refresh, toggleAbsent, getInviteLink,
  } = useTeamData();
  const [card, setCard] = useState(null);       // member whose card is expanded
  const [access, setAccess] = useState(null);   // { member } | { member: null }
  const [invite, setInvite] = useState(null);   // invite link payload

  // The grid is the ROSTER, joined to the score data — not the score list.
  // /operating-score only returns people it has something to say about, so
  // driving the grid off it would hide anyone with no activity yet, and those
  // are exactly the people an owner needs to reach to set access or send a
  // login link. Everyone appears; the score is the part that may be absent.
  const people = useMemo(() => {
    const byId = new Map((data?.employees || []).map((e) => [e.id, e]));
    return members
      .map((m) => {
        const e = byId.get(m.id) || {};
        return { ...m, score: e.score ?? null, done: e.done ?? 0, open: e.open ?? 0, overdue: e.overdue ?? 0 };
      })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [members, data]);

  if (isLoading || !data) {
    return (
      // Same two strata as the real screen, so nothing jumps when data lands.
      <div className="lg:hidden fixed inset-0 z-0 overflow-hidden bg-neutral-950" data-skeleton="ops" data-testid="ops-skeleton">
        <div className="absolute inset-x-0 top-[34svh] bottom-0 rounded-t-[28px] bg-background border-t border-hairline p-5 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      </div>
    );
  }

  const { company, stats } = data;
  // `stats` is {} on a tenant with no activity — every read below is guarded.
  const enough = company.enough_data !== false;
  const overall = enough ? company.overall : null;

  return (
    // One fixed layer holding both strata, so the document itself never
    // scrolls: the only scroller on this screen is the sheet. That is what
    // makes the hero *static* rather than merely slow to leave — see the note
    // on the sheet below.
    <div className="lg:hidden fixed inset-0 z-0 overflow-hidden" data-block="ops" data-testid="ops-mobile">
      {/* ───────── static hero ───────── */}
      <div
        className="absolute inset-x-0 top-0 h-[47svh] overflow-hidden bg-neutral-950"
        data-testid="ops-hero"
      >
        {/* A single soft brand bloom, off-centre. The hero is dark so the page
            has a horizon; the bloom keeps it from reading as a black bar. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(120% 80% at 78% 4%, hsl(var(--brand-600) / 0.30), transparent 62%)" }}
        />
        {/* The hero box is 42svh so its background runs on under the sheet's
            rounded corners with no seam, but its CONTENT is boxed to the 38svh
            the sheet leaves visible — otherwise the bottom row sits behind the
            lip, which is precisely what it did on the first pass.
            pt clears the overlaid app bar; the rest centres in what's left.

            Column, not row: as a row this centres vertically but leaves the
            content sized to itself, so the category tracks stopped ~70px short
            of the gutter. A column stretches children across the cross axis,
            which is the width, and justify-center still does the centring. */}
        {/* gap-4, not gap-2: the counters were crowding the dial and its
            caption. The column is centred, so the extra 8px comes off the
            clearance to the sheet lip at both ends — checked at 375x667, the
            tightest common device, before raising it. */}
        <div className="relative h-[43svh] flex flex-col justify-center gap-4 px-5 pb-4 pt-[calc(env(safe-area-inset-top,0px)+3.5rem)]">
          {enough ? (
            <>
              <div className="flex items-center gap-3">
                <Gauge value={overall} armed={armed} />
                {/* The four categories in their own glass pane — the section
                    reads as one instrument rather than four loose rows. */}
                <div className={cn("flex-1 min-w-0 space-y-1.5 rounded-2xl px-3.5 py-2", GLASS)}>
                  {CATS.map((c, i) => (
                    <CatTrack key={c.key} cat={c} value={company.categories?.[c.key]} armed={armed} index={i} />
                  ))}
                </div>
              </div>

              {/* The company counters, moved up out of the white sheet. They
                  belong with the score: these are the totals the per-person
                  grid below sums to, so they read as part of the instrument
                  panel, not as the first four rows of the roster. */}
              <div className="grid grid-cols-4 gap-2" data-testid="ops-stats">
                <HeroCounter label="Done" value={stats?.done || 0} />
                <HeroCounter label="Open" value={stats?.open || 0} />
                <HeroCounter label="Overdue" value={stats?.overdue || 0} />
                <HeroCounter label="Issues" value={stats?.open_complaints || 0} />
              </div>
            </>
          ) : (
            <div className="flex items-center gap-4" data-testid="ops-not-ready">
              <Gauge value={null} armed={armed} />
              <div className={cn("flex-1 min-w-0 rounded-2xl px-3.5 py-3", GLASS)}>
                <p className="text-white font-heading text-base font-extrabold uppercase tracking-tight leading-tight">
                  Still learning your business
                </p>
                <p className="text-[13px] text-white/55 leading-relaxed mt-1.5">
                  The score starts once there are ~3 actionable tasks or your first invoices.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ───────── sheet, laid over it ─────────
          Its top is pinned at 38svh — 4svh above the hero's bottom edge, so the
          lip already overlaps at rest and the thing reads as an overlay before
          anyone touches it — and the SCROLL IS INTERNAL.

          The first pass put the sheet in normal flow and let the page scroll,
          which slid it up over the hero. It demoed well and was wrong twice
          over: with a team list of any length the sheet keeps rising until it
          has eaten the hero, so the "static" top is only static until you
          scroll past it; and on the way it passes under the overlaid app bar,
          putting a white reversed wordmark on a white sheet. Pinning the sheet
          and scrolling its contents keeps the chart on screen permanently,
          which is the point of splitting the screen at all. */}
      <div
        className="absolute inset-x-0 top-[43svh] bottom-0 z-10 rounded-t-[28px] bg-background border-t border-hairline shadow-[0_-10px_34px_rgba(0,0,0,0.20)] overflow-y-auto overscroll-contain scrollbar-none"
        data-testid="ops-sheet"
      >
        <div className="pb-dock">
          <div className="sticky top-0 z-10 flex justify-center pt-2.5 pb-1.5 bg-background rounded-t-[28px]" aria-hidden="true">
            <div className="h-1 w-9 rounded-full bg-foreground/15" />
          </div>

          <div className="px-5 pt-3">
            {/* The company counters used to open this sheet; they moved onto
                the hero, where they sit with the score they summarise.
                Adding a member moved to Settings — this screen reads the team,
                it no longer creates one. */}
            <div className="flex items-baseline justify-between gap-3 mb-4">
              <h2 className="font-heading text-lg font-extrabold uppercase tracking-tight">Teams &amp; executions</h2>
              {people.length > 0 && (
                <span className="label-mono text-muted-foreground shrink-0">{people.length}</span>
              )}
            </div>

            {/* The list became a grid: two per row, name on its own line, role
                under it. A grid of equal boxes is scannable in a way the old
                row (rank · name · three counters · score · chevron) was not —
                that row had five competing values and truncated the middle one
                on every phone. The score keeps a corner because it is the one
                number this screen is about. */}
            {people.length === 0 ? (
              <div className="pb-8" data-empty-state="true" data-testid="ops-employees-empty-state">
                <div className="rounded-xl border border-dashed border-hairline px-5 py-10 text-center">
                  <p className="text-sm font-semibold">No one on the team yet</p>
                  <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
                    {/* Points at where adding now lives, rather than offering a
                        button this screen no longer owns. */}
                    {canManageTeam
                      ? "Add a teammate in Settings and their execution shows up here."
                      : "Scores appear once your team has tasks assigned and closed."}
                  </p>
                </div>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-2.5 pb-4" data-testid="ops-employees">
                {people.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setCard(p)}
                      data-testid={`ops-emp-${p.id}`}
                      className="flex h-full w-full flex-col justify-between gap-3 rounded-2xl border border-hairline bg-card p-3.5 text-left active:bg-foreground/[0.04] transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-snug break-words">{p.name}</p>
                        <p className="label-mono text-muted-foreground mt-1 truncate">
                          {roleLabel(p.role)}
                        </p>
                      </div>
                      <div className="flex items-end justify-between gap-2">
                        <span className="label-mono text-muted-foreground/70">
                          {absentIds.has(p.id) ? "Absent" : `${p.open ?? 0} open`}
                        </span>
                        {/* An em-dash at font-black/text-lg draws a thick bar
                            that reads as redaction, not as "no score yet". A
                            new member gets a light middle dot instead. */}
                        {p.score != null ? (
                          <span className="font-heading text-lg font-black leading-none tabular-nums text-foreground">
                            {p.score}
                          </span>
                        ) : (
                          <span className="text-lg font-normal leading-none text-muted-foreground/40" title="No score yet">·</span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* The expanded card, and the three management sheets its pills open —
          the same components and the same requests the Team screen uses. */}
      <MemberCard
        member={card}
        open={!!card}
        onClose={() => setCard(null)}
        isAbsent={!!card && absentIds.has(card.id)}
        canEditAccess={!!card && canManageTeam && (card.role !== "owner" || isOwner)}
        canInvite={!!card && canManageTeam && card.role !== "owner" && !!card.phone}
        canMarkAbsent={!!card && canManageTeam && card.role !== "owner"}
        onAccess={(m) => { setCard(null); setAccess({ member: m }); }}
        onInvite={async (m) => {
          const info = await getInviteLink(m);
          if (info) { setCard(null); setInvite(info); }
        }}
        onToggleAbsent={async (m) => { await toggleAbsent(m); setCard(null); }}
      />
      <AccessSheet
        open={!!access}
        onClose={() => setAccess(null)}
        initial={access?.member || null}
        roleOptions={roleOptions}
        members={members}
        onSaved={refresh}
        onInvite={setInvite}
      />
      <InviteSheet info={invite} onClose={() => setInvite(null)} />
    </div>
  );
}
