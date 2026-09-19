// 2026-09-16, founder · OrgCanvas — the desktop Team tree, drawn from the
// founder's reference: the owner on the left, a coloured branch per team, a
// person's reports in the next column, curved connectors with hollow joints.
// Below lg the Team page keeps OrgTree (a row of columns does not fit a phone).
//
// ONE LINE OPEN AT A TIME: the tree opens on the owner and the department
// heads; clicking a person with reports shows those reports in the next column
// and closes whatever else was open at that level, and so on down.
//
// COLUMNS THAT NEVER MOVE (founder, same day). The owner is pinned in the
// vertical middle of the pane. Every level is its own full-height column: its
// cards spread over the height when they fit and the column scrolls on its own
// when they do not. Opening a level only adds or replaces columns to its right
// — nothing to its left moves, re-centres or rescales. The team space scrolls
// sideways, because a reporting line can be any number of levels deep. The
// connectors live in lanes between columns and are measured from where the
// cards actually are, so they follow a column's scroll.
//
// Presentation only, like OrgTree: TeamPanel owns the data, the search and the
// dialogs.
import { Fragment, forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AirplaneTakeoff, CaretRight, Plus, User } from "@phosphor-icons/react";
import { PersonAvatar } from "../../components/karma/PersonAvatar";
import { GLASS_PILL } from "../../components/karma/glass";
import { MEMBER_STATUS, teamIcon } from "./OrgTree";

// ---------------------------------------------------------------------------
// Colour: one hue per team, read from its key and label like the team icon,
// so Sales is violet, Production orange, Finance green and Operations pink
// wherever a tenant names them; unknown teams take the next free hue.
// ---------------------------------------------------------------------------
const HUE_RULES = [
  [/sales|business dev/i, 252],
  [/production|manufactur|factory|plant/i, 26],
  [/financ|account|billing|payment/i, 150],
  [/operation|\bops\b/i, 338],
  [/market/i, 205],
  [/support|service|customer/i, 188],
  [/purchas|procure/i, 42],
  [/logistic|deliver|dispatch|warehouse/i, 216],
  [/\bhr\b|human|talent|people/i, 290],
  [/tech|engineer|\bit\b|develop/i, 232],
];
const HUE_FALLBACK = [252, 26, 150, 338, 205, 42, 188, 290];
const ROOT_HUE = 250;

function teamHue(key, label, index) {
  const text = `${String(key).replace(/_/g, " ")} ${label}`;
  const hit = HUE_RULES.find(([re]) => re.test(text));
  return hit ? hit[1] : HUE_FALLBACK[index % HUE_FALLBACK.length];
}

const tone = (h) => ({
  line: `hsl(${h} 68% 72%)`,
  ink: `hsl(${h} 62% 50%)`,
  chipBg: `hsl(${h} 90% 96%)`,
  chipInk: `hsl(${h} 48% 44%)`,
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
const ROOT_W = 240;
const CARD = {
  head: { w: 320, h: 78 },
  team: { w: 320, h: 78 },
  person: { w: 290, h: 66 },
};
const LANE_W = 120; // the connector lane between two columns

/* THE LANE IS SPLIT IN TWO, and the split is what fixes the scroll lag.
   A column scrolls on the COMPOSITOR: its cards are already drawn at the new
   offset in the frame the scroll event is delivered, so anything redrawn from
   that event by main-thread JS is answering a question the compositor has
   already moved past. Measured off composited frames (CDP screencast, not the
   DOM — reading getBoundingClientRect cannot see this, because both sides read
   the same main-thread scroll offset and agree with each other while the screen
   disagrees with both): redrawing on rAF lagged 20.8px on average, and doing it
   synchronously in the scroll handler still lagged 11.0px. There is no main-
   thread schedule that reaches zero.
   So the branches stop being redrawn and start being SCROLLED: the part of the
   lane from the trunk rightward moves inside the column, as a left gutter in
   its scrolling content, and the browser moves it with the cards for free. The
   stem stays behind in a narrower lane, anchored to the parent card.
   The widths are a split, not an addition — STEM_W + GUTTER_W === LANE_W — so
   the tree's horizontal layout is unchanged; only which element owns the 72px
   changes. */
const STEM_W = Math.round(LANE_W * 0.4); // 48 — stays in the lane with the stem
const GUTTER_W = LANE_W - STEM_W;        // 72 — moves into the scrolling column
const ELBOW_R = 14; // corner radius where a branch leaves the trunk
const ADD_H = 56; // the "Add member" node at the top of a column
const ADD_LINE = "hsl(230 16% 74%)"; // its branch: neutral and dashed, not a person
const COL_PAD_Y = 20; // breathing room above and below a column's cards
const MIN_GAP = 14; // cards never closer than this…
const MAX_GAP = 56; // …nor further apart when a column has height to spare

const NODE = "bg-white/80 ring-1 ring-inset ring-white shadow-[0_14px_34px_-18px_hsl(245_30%_30%/0.34),0_1px_2px_hsl(245_30%_30%/0.06)] backdrop-blur-xl";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30";
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

/* Cheap equality for the measured lanes, replacing a JSON.stringify of the
   whole set. That ran on every scroll event and serialised every lane to
   answer a question about a handful of numbers; this compares the numbers. */
function sameLines(a, b) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const x = a[k];
    const y = b[k];
    if (!y || x.h !== y.h || x.y1 !== y.y1 || x.stemHue !== y.stemHue || x.mono !== y.mono || x.gutter !== y.gutter) return false;
    if (x.kids.length !== y.kids.length) return false;
    for (let i = 0; i < x.kids.length; i++) {
      const p = x.kids[i];
      const q = y.kids[i];
      if (p.id !== q.id || p.y !== q.y || p.hue !== q.hue || p.add !== q.add) return false;
    }
  }
  return true;
}

/* The page is CSS-zoomed by --ui-scale (hooks/useUiScale): getBoundingClientRect
   reports VISUAL px, while heights and SVG coordinates are set in an element's
   own px. Every measurement divides by this so the pane and the connectors
   stay right at 0.9…1.3, not only at the 1440px reference where it is 1. */
function zoomOf(el) {
  const z = el && typeof el.currentCSSZoom === "number"
    ? el.currentCSSZoom
    : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"));
  return z > 0 ? z : 1;
}

/* One team's reporting lines: who reports to whom inside the team, and who
   sits at the top. Someone whose manager is in another team, or who has none,
   starts a line; ties go to whoever manages more people, then by name. */
function teamLines(members) {
  const ids = new Set(members.map((u) => u.id));
  const reports = new Map();
  members.forEach((u) => {
    const m = ids.has(u.reporting_manager_id) && u.reporting_manager_id !== u.id ? u.reporting_manager_id : null;
    if (!reports.has(m)) reports.set(m, []);
    reports.get(m).push(u);
  });
  const size = (u) => (reports.get(u.id) || []).length;
  const sorted = (list) => [...list].sort((a, b) => size(b) - size(a) || byName(a, b));
  const reached = new Set();
  const reach = (id) => (reports.get(id) || []).forEach((u) => {
    if (reached.has(u.id)) return;
    reached.add(u.id);
    reach(u.id);
  });
  reach(null);
  const tops = sorted(reports.get(null) || []);
  // A reporting loop has no top; its first member starts a line so nobody is lost.
  members.forEach((u) => {
    if (reached.has(u.id)) return;
    reached.add(u.id);
    tops.push(u);
    reach(u.id);
  });
  return { tops, reportsOf: (id) => sorted(reports.get(id) || []) };
}

/* Every team's reporting tree (the whole thing; what is drawn is decided by
   the open path). A search keeps a team whole when its name matches, and
   otherwise keeps matches plus everyone on the way to them. */
function buildForest({ teams, searching, matches, teamMatches }) {
  const heads = [];
  teams.forEach((team, index) => {
    if (!team.members.length) return;
    const hue = teamHue(team.key, team.label, index);
    const lines = teamLines(team.members);
    const teamHit = searching && teamMatches(team);
    const keepMemo = new Map();
    const keep = (u) => {
      if (keepMemo.has(u.id)) return keepMemo.get(u.id);
      keepMemo.set(u.id, false); // loop guard
      const v = !searching || teamHit || matches(u) || lines.reportsOf(u.id).some(keep);
      keepMemo.set(u.id, v);
      return v;
    };
    const placed = new Set();
    const person = (u, depth) => {
      placed.add(u.id);
      const hit = searching && (teamHit || matches(u));
      const node = { id: u.id, kind: depth === 1 ? "head" : "person", u, team, hue, depth, kids: [], match: hit, dim: searching && !hit };
      node.kids = lines.reportsOf(u.id)
        .filter(keep)
        .map((r) => (placed.has(r.id) ? null : person(r, depth + 1)))
        .filter(Boolean);
      return node;
    };
    const tops = lines.tops.filter(keep);
    if (!tops.length) return;
    if (tops.length === 1) {
      heads.push(person(tops[0], 1));
      return;
    }
    // Several people at the top of a team: the team itself is the branch.
    const node = { id: `team:${team.key}`, kind: "team", team, hue, depth: 1, kids: [], match: teamHit, dim: false };
    node.kids = tops.map((u) => (placed.has(u.id) ? null : person(u, 2))).filter(Boolean);
    heads.push(node);
  });
  return heads;
}

/* The ids to open so a search's first match is on screen. */
function pathToFirstMatch(heads) {
  const walk = (n, trail) => {
    if (n.match) return trail;
    for (const k of n.kids) {
      const found = walk(k, [...trail, n.id]);
      if (found) return found;
    }
    return null;
  };
  for (const h of heads) {
    const found = walk(h, []);
    if (found) return found;
  }
  return [];
}

/* The ids to open so a person's own card is showing: everyone above them. */
function pathToPerson(heads, id) {
  if (!id) return [];
  const walk = (n, trail) => {
    if (n.u?.id === id) return trail;
    for (const k of n.kids) {
      const found = walk(k, [...trail, n.id]);
      if (found) return found;
    }
    return null;
  };
  for (const h of heads) {
    const found = walk(h, []);
    if (found) return found;
  }
  return [];
}

/* The open path -> the columns to draw: the heads, then the reports of each
   person opened along the path. */
function columnsFor(heads, path) {
  const columns = [heads];
  const opened = [];
  let list = heads;
  for (const id of path) {
    const sel = list.find((n) => n.id === id);
    if (!sel || !sel.kids.length) break;
    opened.push(sel);
    columns.push(sel.kids);
    list = sel.kids;
  }
  return { columns, opened };
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
function You({ id }) {
  return (
    <span data-testid={`is-you-${id}`}
      className="shrink-0 rounded-md bg-slate-900/[0.06] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
      YOU
    </span>
  );
}

/* The dot on a face: green active, amber invite pending, grey inactive, and a
   small orange plane for someone out today. */
function Presence({ u, outToday, big = false }) {
  const status = MEMBER_STATUS[u.invite_status] || MEMBER_STATUS.active;
  const away = outToday && status === MEMBER_STATUS.active;
  const label = away ? "Out today" : status.label;
  if (away) {
    return (
      <span role="img" aria-label={label} title={label} data-testid={`status-${u.id}`}
        className={`absolute grid place-items-center rounded-full bg-orange-500 text-white ring-2 ring-white ${big ? "bottom-3 left-3 h-6 w-6" : "-bottom-0.5 -right-0.5 h-4 w-4"}`}>
        <AirplaneTakeoff size={big ? 13 : 9} weight="bold" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} title={label} data-testid={`status-${u.id}`}
      className={`absolute rounded-full ring-2 ring-white ${status.dot} ${big ? "bottom-4 left-4 h-4 w-4" : "bottom-0 right-0 h-3 w-3"}`} />
  );
}

function Face({ u, size, outToday }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <PersonAvatar name={u.name} src={u.avatar_url} size={size} ring
        className="shadow-[0_6px_14px_-8px_hsl(245_30%_30%/0.5)]" />
      <Presence u={u} outToday={outToday} />
    </span>
  );
}

/* The control on a card's right edge (founder, same day): how many direct
   reports sit under this card, with the arrow that opens them in the next
   column. Filled in the branch colour while they are showing. */
function ReportsToggle({ count, open, hue, name, onToggle, testid }) {
  const t = tone(hue);
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} data-testid={testid}
      aria-label={`${open ? "Hide" : "Show"} ${name}'s ${count} direct ${count === 1 ? "report" : "reports"}`}
      title={open ? "Hide direct reports" : "Show direct reports"}
      className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full pl-3.5 pr-3 text-[15px] font-semibold tabular-nums transition-[background-color,color,box-shadow] hover:shadow-[0_6px_16px_-8px_hsl(245_30%_30%/0.45)] ${FOCUS}`}
      style={open
        ? { background: t.ink, color: "white", border: "1px solid transparent" }
        : { background: t.chipBg, color: t.chipInk, border: `1px solid ${t.line}` }}>
      <User size={16} weight="bold" aria-hidden="true" />
      {count}
      <CaretRight size={16} weight="bold" aria-hidden="true" />
    </button>
  );
}

/* The owner, pinned in the middle of the first column. The short stem from the
   photo to the column edge is where the heads' connectors start. */
function RootColumn({ owners, ctx, register }) {
  const single = owners.length === 1;
  return (
    <div ref={single ? undefined : (el) => register("root", el)} data-testid="team-root"
      className="flex shrink-0 flex-col items-stretch justify-center gap-6" style={{ width: ROOT_W }}>
      {owners.map((u, i) => {
        const direct = ctx.directReports(u.id);
        const people = ctx.total;
        // What the API has for them (founder: "always show what is stored"):
        // their job title, or their role's name when no title is set.
        const badge = ctx.titleOf(u);
        return (
          <div key={u.id} className="flex flex-col items-center">
            <div ref={single && i === 0 ? (el) => register("root", el) : undefined} className="relative flex w-full justify-center">
              {single && ctx.hasHeads && (
                <span aria-hidden="true" className="absolute right-0 top-1/2 h-[1.5px] -translate-y-1/2"
                  style={{ left: "calc(50% + 78px)", background: tone(ROOT_HUE).line }} />
              )}
              <button type="button" onClick={() => ctx.onOpen(u)} data-testid={`team-member-${u.id}`}
                aria-label={`Open profile for ${u.name}`}
                className={`group relative grid shrink-0 place-items-center rounded-full ${FOCUS}`}>
                <span aria-hidden="true" className="absolute -inset-5 rounded-full"
                  style={{ background: `radial-gradient(circle, hsl(${ROOT_HUE} 95% 82% / 0.55), transparent 68%)` }} />
                <span className="relative grid h-[156px] w-[156px] place-items-center rounded-full bg-white/55 ring-1 ring-inset ring-white shadow-[0_20px_44px_-20px_hsl(250_45%_40%/0.55)] backdrop-blur-xl transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transition-none">
                  <PersonAvatar name={u.name} src={u.avatar_url} size={130} ring={false} />
                </span>
                <Presence u={u} outToday={ctx.outIds.has(u.id)} big />
                <span data-testid={`member-title-${u.id}`}
                  className="absolute -bottom-2.5 left-1/2 max-w-[9rem] -translate-x-1/2 truncate rounded-full bg-[linear-gradient(180deg,hsl(250_75%_80%),hsl(252_55%_66%))] px-3.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_6px_14px_-6px_hsl(252_55%_45%/0.7)]">
                  {badge}
                </span>
              </button>
            </div>
            <p className="mt-6 flex max-w-full items-center gap-1.5 px-2">
              <span className="truncate text-[18px] font-semibold text-slate-900">{u.name}</span>
              {u.id === ctx.meId && <You id={u.id} />}
            </p>
            <button type="button" onClick={() => ctx.onOpen(u)}
              className={`mt-3 inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12.5px] text-slate-600 transition-colors hover:bg-white hover:text-slate-900 ${GLASS_PILL} ${FOCUS}`}>
              {direct > 0
                ? `${direct} direct ${direct === 1 ? "report" : "reports"}`
                : `${people} ${people === 1 ? "person" : "people"}`}
              <CaretRight size={12} weight="bold" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* A person: a department head (first column, with the team's glyph) or anyone
   below. Clicking the card opens their profile; the count on its right edge
   opens their direct reports. */
function PersonCard({ node, ctx, register }) {
  const { u, team } = node;
  const head = node.kind === "head";
  const t = tone(node.hue);
  const Icon = head ? teamIcon(team.key, team.label) : null;
  const size = CARD[node.kind];
  const count = node.kids.length;
  const open = ctx.openIds.has(node.id);
  const Shell = head ? "section" : "div";
  const shellProps = head ? { "aria-label": `${team.label} team`, "data-testid": `team-branch-${team.key}` } : {};
  return (
    <Shell {...shellProps} ref={(el) => register(node.id, el)}
      className={`relative flex shrink-0 items-center gap-2 rounded-full pl-2 pr-2.5 transition-opacity ${NODE} ${node.dim ? "opacity-45" : ""}`}
      style={{ width: size.w, height: size.h, ...(open ? { outline: `2px solid ${t.line}`, outlineOffset: -2 } : null) }}>
      <button type="button" data-testid={`team-member-${u.id}`}
        onClick={() => ctx.onOpen(u)}
        aria-label={`Open profile for ${u.name}`}
        className={`flex h-full min-w-0 flex-1 items-center gap-3 rounded-full text-left ${FOCUS}`}>
        <Face u={u} size={head ? 56 : 50} outToday={ctx.outIds.has(u.id)} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            {Icon && <Icon size={17} weight="duotone" aria-hidden="true" className="shrink-0" style={{ color: t.ink }} />}
            <span className={`truncate font-semibold text-slate-900 ${head ? "text-[15px]" : "text-[14px]"}`}>{u.name}</span>
            {u.id === ctx.meId && <You id={u.id} />}
          </span>
          <span data-testid={`member-title-${u.id}`} className={`mt-0.5 block truncate text-slate-500 ${head ? "text-[13px]" : "text-[12.5px]"}`}>
            {ctx.titleOf(u)}
          </span>
        </span>
      </button>
      {count > 0 && (
        <ReportsToggle count={count} open={open} hue={node.hue} name={u.name}
          onToggle={() => ctx.toggle(node)}
          testid={head ? `team-dept-toggle-${team.key}` : `team-reports-toggle-${u.id}`} />
      )}
    </Shell>
  );
}

/* A team with several people at its top: the team is the branch, and opening
   it shows those people. */
function TeamCard({ node, ctx, register }) {
  const { team } = node;
  const t = tone(node.hue);
  const Icon = teamIcon(team.key, team.label);
  const open = ctx.openIds.has(node.id);
  const count = node.kids.length;
  return (
    <section ref={(el) => register(node.id, el)} aria-label={`${team.label} team`} data-testid={`team-branch-${team.key}`}
      className={`relative flex shrink-0 items-center gap-2 rounded-full pl-2 pr-2.5 ${NODE}`}
      style={{ width: CARD.team.w, height: CARD.team.h, ...(open ? { outline: `2px solid ${t.line}`, outlineOffset: -2 } : null) }}>
      {/* A team has no profile, so the card itself opens its people too. */}
      <button type="button" onClick={() => ctx.toggle(node)} aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} the ${team.label} team`}
        className={`flex h-full min-w-0 flex-1 items-center gap-3 rounded-full text-left ${FOCUS}`}>
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full" style={{ background: t.chipBg, color: t.ink }}>
          <Icon size={26} weight="duotone" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-slate-900">{team.label}</span>
          <span className="block text-[13px] text-slate-500">{team.members.length} {team.members.length === 1 ? "person" : "people"}</span>
        </span>
      </button>
      <ReportsToggle count={count} open={open} hue={node.hue} name={`the ${team.label} team`}
        onToggle={() => ctx.toggle(node)} testid={`team-dept-toggle-${team.key}`} />
    </section>
  );
}

/* The "Add member" node at the top of every open column (founder, same day).
   forwardRef + spread props so TeamPanel can make it the trigger of the Add
   member dialog, pre-filled with who the new person reports to. */
export const AddNode = forwardRef(function AddNode({ label = "Add member", hint, width, height, ...props }, ref) {
  return (
    <button ref={ref} type="button" {...props}
      className={`flex shrink-0 items-center gap-3 rounded-full border border-dashed border-slate-900/[0.2] bg-white/45 pl-2 pr-4 text-left backdrop-blur-xl transition-colors hover:border-slate-900/35 hover:bg-white/80 ${FOCUS}`}
      style={{ width, height }}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-slate-700 ring-1 ring-inset ring-slate-900/[0.08] shadow-[0_4px_12px_-6px_hsl(245_30%_30%/0.35)]">
        <Plus size={16} weight="bold" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-slate-800">{label}</span>
        {hint && <span className="block truncate text-[12px] text-slate-500">{hint}</span>}
      </span>
    </button>
  );
});

const columnWidth = (items) => (items.length ? Math.max(...items.map((n) => CARD[n.kind].w)) : CARD.head.w);

/* Whether a level's cards fit its height, and the gap that spreads them. Lives
   out here because the PARENT has to know the answer too: a column that scrolls
   takes the connector into its own content (see STEM_W/GUTTER_W), and a column
   that fits keeps the whole lane outside it. */
function columnLayout(items, add, height) {
  const heights = [...(add ? [ADD_H] : []), ...items.map((n) => CARD[n.kind].h)];
  const count = heights.length;
  const cardsH = heights.reduce((sum, h) => sum + h, 0);
  const avail = height - COL_PAD_Y * 2;
  const needed = cardsH + Math.max(0, count - 1) * MIN_GAP;
  const fits = needed <= avail;
  const gap = fits
    ? Math.min(MAX_GAP, Math.max(MIN_GAP, (avail - cardsH) / (count + 1)))
    : MIN_GAP;
  return { fits, gap };
}

/* The connector drawn INSIDE a scrolling column, in its content coordinates,
   so the browser scrolls it with the cards instead of us redrawing it.

   THE TRUNK RUNS THE FULL CONTENT HEIGHT, and that is forced rather than
   chosen. The stem is anchored to the parent card in the lane outside this
   scroller; the branches are anchored to cards inside it. The trunk joins the
   two, so it has to be able to meet the stem at ANY scroll offset — a trunk
   clipped to its outermost branch would part company with the stem the moment
   the column moved. A spine with the branches teeing off it is also what the
   bounded version already converges to once a column holds enough people to
   scroll, which is the only case this path is used for: at fifteen cards the
   old trunk already spanned nearly the whole column and its middle branches
   were already horizontal.

   Positions come from offsetTop, never from getBoundingClientRect: offsetTop
   is measured against this wrapper and does not move when the column scrolls,
   so there is nothing to recompute per frame. */
function ColumnConnector({ line }) {
  if (!line || !line.kids.length) return null;
  const structural = tone(ROOT_HUE).line;
  const mono = !!line.mono;
  const trunk = mono ? structural : tone(line.stemHue).line;
  const dotX = GUTTER_W - 10;
  const colourOf = (k) => (k.add ? ADD_LINE : mono ? structural : tone(k.hue).line);
  return (
    <svg aria-hidden="true" width={GUTTER_W}
      className="pointer-events-none absolute left-0 top-0 h-full"
      style={{ overflow: "visible" }}>
      {/* .75 so a 1.5 stroke sits on the pixel rather than across two */}
      <line x1="0.75" y1="0" x2="0.75" y2="100%" stroke={trunk} strokeWidth="1.5" />
      {line.kids.map((k) => (
        <path key={k.id} d={`M 0.75 ${k.y} H ${GUTTER_W}`} stroke={colourOf(k)} strokeWidth="1.5"
          fill="none" strokeLinecap="round" strokeDasharray={k.add ? "4 4" : undefined} />
      ))}
      {line.kids.map((k) => (
        <circle key={`dot-${k.id}`} cx={dotX} cy={k.y} r="3.5" fill="white"
          stroke={colourOf(k)} strokeWidth="1.5" />
      ))}
    </svg>
  );
}

/* One level: a full-height column. Cards that fit spread over its height;
   cards that do not scroll inside it. The "Add member" node, when the viewer
   may add people, sits at the top.

   The scroller and the flex box are two elements now: the inner one is the
   positioning context the gutter connector is absolutely placed in, and it is
   what offsetTop is measured against. min-h-full keeps `justify-center` doing
   what it did when the scroller itself was the flex box. */
function LevelColumn({ items, add, index, height, ctx, register, onScroll, gutter, line, registerContent }) {
  const width = columnWidth(items);
  const { fits, gap } = columnLayout(items, add, height);
  return (
    <div
      role="list"
      aria-label={index === 0 ? "Departments" : "Direct reports"}
      data-testid={`team-level-${index + 1}`}
      onScroll={onScroll}
      className="shrink-0 overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        width: width + (gutter ? GUTTER_W : 0),
        height,
        overflowY: fits ? "hidden" : "auto",
        overflowX: "visible",
      }}
    >
      <div
        ref={registerContent}
        className="relative flex min-h-full flex-col items-start"
        style={{
          gap,
          paddingBlock: COL_PAD_Y,
          paddingLeft: gutter ? GUTTER_W : 0,
          justifyContent: fits ? "center" : "flex-start",
        }}
      >
        {gutter && <ColumnConnector line={line} />}
        {add && (
          <div ref={(el) => register(add.id, el)} className="shrink-0">{add.element}</div>
        )}
        {items.map((n) => {
          const Card = n.kind === "team" ? TeamCard : PersonCard;
          return <Card key={n.id} node={n} ctx={ctx} register={register} />;
        })}
      </div>
    </div>
  );
}

/* The connectors between two columns, drawn as an org-chart bus (founder:
   "the lines doesn't flow good and split occurs badly"): a straight stem out
   of the opened card to a hollow joint, one vertical trunk through the joint,
   and a rounded elbow off the trunk into each card it opened. Curves between
   cards spread over a full column turned into near-vertical S-bends all
   leaving one point; straight runs and true corners stay readable at any
   distance.

   COLOUR, 2026-09-19 (founder): the first two lanes are ONE colour and only
   the levels below them fan out into team hues. Reading the top of the tree,
   every branch already carries its team's colour in the card it lands on —
   coloured lines there as well turned the shallowest, most-looked-at part of
   the chart into a rainbow with no information in it. Deeper down, where a
   column can hold people from several teams, the line is the only thing
   saying which team a branch belongs to, so the hues come back. `mono` is
   set on the lane, not read from depth here, so the rule lives next to the
   lanes it describes.

   Drawn from measured positions, so it follows each column's scroll. */

/* One lane's geometry as pure data. React renders this, and the scroll
   repaint in OrgCanvas rewrites the very same shapes straight onto the DOM —
   one function so the two can never draw different charts. */
function laneGeom(line) {
  const jx = Math.round(LANE_W * 0.4);
  const dotX = LANE_W - 10;
  const y1 = line.y1;
  const structural = tone(ROOT_HUE).line;
  const mono = !!line.mono;
  const trunkColor = mono ? structural : tone(line.stemHue).line;

  const branches = line.kids.map((k) => {
    const dy = k.y - y1;
    const s = Math.sign(dy);
    const r = Math.min(ELBOW_R, Math.abs(dy));
    const flat = Math.abs(dy) < 0.5;
    /* An "Add member" node hangs off the JOINT on a dashed run of its own.
       It used to take an elbow off the trunk like anyone else, which meant
       the trunk was extended upward to reach it — so the branch was dashed
       but the long vertical leading to it was solid, and the whole connector
       read as a continuous line into a dashed stub (founder, 2026-09-19).
       Nothing solid should run to a node that is not a person. */
    const d = k.add && !flat
      ? `M ${jx} ${y1} V ${k.y - s * r} Q ${jx} ${k.y}, ${jx + r} ${k.y} H ${LANE_W}`
      : flat
        ? `M ${jx} ${k.y} H ${LANE_W}`
        : `M ${jx} ${k.y - s * r} Q ${jx} ${k.y}, ${jx + r} ${k.y} H ${LANE_W}`;
    return {
      id: k.id,
      add: !!k.add,
      y: k.y,
      dy,
      r,
      color: k.add ? ADD_LINE : mono ? structural : tone(k.hue).line,
      d,
    };
  });

  // …and so the solid trunk spans the PEOPLE only, never the add node.
  const people = branches.filter((b) => !b.add);
  const trunkTop = Math.min(y1, ...people.map((b) => (b.dy < 0 ? b.y + b.r : y1)));
  const trunkBottom = Math.max(y1, ...people.map((b) => (b.dy > 0 ? b.y - b.r : y1)));

  return {
    jx,
    dotX,
    y1,
    trunkColor,
    stemD: `M 0 ${y1} H ${jx}`,
    trunkD: trunkBottom - trunkTop > 0.5 ? `M ${jx} ${trunkTop} V ${trunkBottom}` : "",
    branches,
  };
}

/* data-org / data-id are how the scroll repaint finds these again. They are
   read with dataset rather than an attribute selector so an id carrying a
   colon (team:sales) never has to be escaped. */
function ConnectorLane({ laneKey, line, register, stemOnly }) {
  const g = line && line.kids.length > 0 ? laneGeom(line) : null;
  return (
    <div ref={(el) => register(laneKey, el)} aria-hidden="true" className="relative shrink-0 self-stretch"
      style={{ width: stemOnly ? STEM_W : LANE_W }}>
      {/* The column below took the trunk and the branches into its own scroll,
          so all that is left here is the stem and the joint it ends on. The
          joint sits exactly on the boundary, which is the gutter's spine —
          overflow stays visible so the circle is not sliced in half by the
          lane's edge. */}
      {g && stemOnly && (
        <svg className="absolute inset-0" width={STEM_W} height={line.h} style={{ overflow: "visible" }}>
          <path data-org="stem" d={`M 0 ${g.y1} H ${STEM_W}`} stroke={g.trunkColor} strokeWidth="1.5" fill="none" />
          <circle data-org="joint" cx={STEM_W} cy={g.y1} r="4" fill="white" stroke={g.trunkColor} strokeWidth="1.5" />
        </svg>
      )}
      {g && !stemOnly && (
        <svg className="absolute inset-0" width={LANE_W} height={line.h} style={{ overflow: "hidden" }}>
          <path data-org="stem" d={g.stemD} stroke={g.trunkColor} strokeWidth="1.5" fill="none" />
          <path data-org="trunk" d={g.trunkD} stroke={g.trunkColor} strokeWidth="1.5" fill="none" />
          {g.branches.map((b) => (
            <path key={b.id} data-org="branch" data-id={b.id} d={b.d} stroke={b.color} strokeWidth="1.5"
              fill="none" strokeLinecap="round" strokeDasharray={b.add ? "4 4" : undefined} />
          ))}
          {g.branches.map((b) => (
            <circle key={`dot-${b.id}`} data-org="dot" data-id={b.id} cx={g.dotX} cy={b.y} r="3.5"
              fill="white" stroke={b.color} strokeWidth="1.5" />
          ))}
          <circle data-org="joint" cx={g.jx} cy={g.y1} r="4" fill="white" stroke={g.trunkColor} strokeWidth="1.5" />
        </svg>
      )}
    </div>
  );
}

/**
 * @param {object[]} owners       the root: every owner
 * @param {object[]} teams        { key, label, members } per team, in the tenant's order, unfiltered
 * @param {string}   query        the search text ("" when none)
 * @param {function} matches      (user) => whether they match the search
 * @param {function} teamMatches  (team) => whether the team's name matches
 * @param {function} titleOf      (user) => the line under their name
 * @param {string}   meId         the signed-in user's id
 * @param {Set}      outIds       ids of people out today
 * @param {function} onOpen       (user) => open their profile
 * @param {function} renderAdd    ({ managerId, role, hint, testid, width, height }) => the "Add member"
 *                                trigger at the top of a column, or omitted when the viewer may not add
 */
export function OrgCanvas({ owners = [], teams = [], query = "", matches, teamMatches, titleOf, meId, outIds, onOpen, renderAdd }) {
  const searching = !!query;
  const heads = useMemo(
    () => buildForest({ teams, searching, matches, teamMatches }),
    [teams, searching, matches, teamMatches],
  );

  // The open line: one id per level, heads first. It opens on the levels down
  // to the viewer's own card (founder, 2026-09-16); a search opens the way to
  // its first match, and clearing it goes back to the viewer's line.
  const headsRef = useRef(heads);
  headsRef.current = heads;
  const [path, setPath] = useState(() => pathToPerson(heads, meId));
  useEffect(() => {
    setPath(query ? pathToFirstMatch(headsRef.current) : pathToPerson(headsRef.current, meId));
  }, [query, meId]);

  const { columns, opened } = columnsFor(heads, path);
  const openIds = new Set(opened.map((n) => n.id));
  const openKey = opened.map((n) => n.id).join(">");

  // The "Add member" node at the top of each column, when the viewer may add
  // people: Add member opens with "Reports to" filled in — the owner for the
  // department heads (and for a team branch), otherwise the person opened —
  // and, below the heads, that person's team.
  const primaryOwner = owners[0] || null;
  const adds = renderAdd
    ? columns.map((items, i) => {
      const sel = i === 0 ? null : opened[i - 1];
      const manager = !sel || sel.kind === "team" ? primaryOwner : sel.u;
      const where = i === 0 ? "heads" : sel.id;
      return {
        id: `add:${where}`,
        element: renderAdd({
          managerId: manager?.id || "",
          role: sel ? sel.team.key : undefined,
          hint: manager ? `Reports to ${manager.name}` : undefined,
          testid: `team-add-${where}`,
          width: columnWidth(items),
          height: ADD_H,
        }),
      };
    })
    : [];

  const everyone = useMemo(() => teams.flatMap((t) => t.members), [teams]);
  const ctx = {
    meId,
    outIds: outIds || new Set(),
    titleOf,
    onOpen,
    openIds,
    hasHeads: heads.length > 0 || !!adds[0],
    total: everyone.length,
    directReports: (id) => everyone.filter((m) => m.reporting_manager_id === id).length,
    // Open a card's reports and close anything else open at its level or
    // below; clicking the open card again closes it.
    toggle: (node) => setPath((prev) => {
      const level = node.depth - 1;
      return prev[level] === node.id ? prev.slice(0, level) : [...prev.slice(0, level), node.id];
    }),
  };

  // ---- the pane takes the rest of the window below the header ------------
  const boxRef = useRef(null);
  const [boxH, setBoxH] = useState(560);
  useLayoutEffect(() => {
    const measureBox = () => {
      const el = boxRef.current;
      if (!el) return;
      // Visual px -> the pane's own px (see zoomOf).
      setBoxH(Math.max(480, Math.round((window.innerHeight - el.getBoundingClientRect().top) / zoomOf(el) - 16)));
    };
    measureBox();
    // The "Currently out" strip and the read-only banner load in above the pane.
    const late = window.setTimeout(measureBox, 600);
    window.addEventListener("resize", measureBox);
    return () => {
      window.clearTimeout(late);
      window.removeEventListener("resize", measureBox);
    };
  }, [outIds?.size]);

  // ---- connectors, measured from the cards ---------------------------------
  const cardEls = useRef(new Map());
  const laneEls = useRef(new Map());
  const registerCard = useCallback((id, el) => {
    if (el) cardEls.current.set(id, el); else cardEls.current.delete(id);
  }, []);
  const registerLane = useCallback((key, el) => {
    if (el) laneEls.current.set(key, el); else laneEls.current.delete(key);
  }, []);

  // Each lane's branches: the column's "Add member" node first, then its cards.
  const branchesTo = (i) => [...(adds[i] ? [{ id: adds[i].id, add: true }] : []), ...columns[i]];
  /* A column that scrolls draws its own connector inside itself; one that fits
     leaves it in the lane. Same maths the column runs, asked one level up. */
  const scrolls = columns.map((items, i) => !columnLayout(items, adds[i], boxH).fits);
  const lanes = [];
  /* MONO_LANES — how many lanes down from the root stay one colour. 2 covers
     the root's own branches and the level below them; from the third lane the
     branches take their team hue again (see the note on laneGeom). */
  const MONO_LANES = 2;
  if (owners.length && (heads.length || adds[0])) lanes.push({ key: "lane-0", fromId: "root", stemHue: ROOT_HUE, mono: true, gutter: scrolls[0], col: 0, to: branchesTo(0) });
  opened.forEach((sel, i) => lanes.push({ key: `lane-${i + 1}`, fromId: sel.id, stemHue: sel.hue, mono: i + 1 < MONO_LANES, gutter: scrolls[i + 1], col: i + 1, to: branchesTo(i + 1) }));
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;

  const [lines, setLines] = useState({});

  // Where every lane's stem and branches currently are. Pure: it reads the
  // DOM and returns, so both the state path and the scroll repaint can call
  // it without one of them having to own the other.
  const measureLanes = useCallback(() => {
    const next = {};
    lanesRef.current.forEach((lane) => {
      const laneEl = laneEls.current.get(lane.key);
      const fromEl = cardEls.current.get(lane.fromId);
      if (!laneEl || !fromEl) return;
      const lr = laneEl.getBoundingClientRect();
      const fr = fromEl.getBoundingClientRect();
      const z = zoomOf(laneEl); // visual px -> the lane's own px, where the SVG draws
      next[lane.key] = {
        h: Math.round(lr.height / z),
        y1: Math.round((fr.top + fr.height / 2 - lr.top) / z),
        stemHue: lane.stemHue,
        mono: !!lane.mono,
        gutter: !!lane.gutter,
        /* A GUTTER LANE'S BRANCHES ARE MEASURED WITH offsetTop, not with a
           rect. offsetTop is relative to the column's content wrapper, so it
           does not change when the column scrolls — which is the whole point:
           those branches are drawn inside that wrapper and scroll with it, so
           they must be positioned in its coordinates and must never be
           re-measured per frame. Own px on both sides, so no zoom divide. */
        kids: lane.to
          .map((n) => {
            const el = cardEls.current.get(n.id);
            if (!el) return null;
            if (lane.gutter) {
              return { id: n.id, hue: n.hue, add: !!n.add, y: Math.round(el.offsetTop + el.offsetHeight / 2) };
            }
            const r = el.getBoundingClientRect();
            return { id: n.id, hue: n.hue, add: !!n.add, y: Math.round((r.top + r.height / 2 - lr.top) / z) };
          })
          .filter(Boolean),
      };
    });
    return next;
  }, []);

  const measure = useCallback(() => {
    const next = measureLanes();
    setLines((prev) => (sameLines(prev, next) ? prev : next));
  }, [measureLanes]);

  /* THE SCROLL REPAINT, and why it does not go through state.
     A column scrolls on the compositor and its cards are already at their new
     offset in the frame the scroll event fires in. The old path answered that
     with requestAnimationFrame -> measure -> setLines -> render, so the lines
     landed a frame or two behind the cards they point at: scrolling, the
     founder saw the two moving "in different phase with lag". React's
     scheduler is the part that cannot be hurried here — a continuous event's
     update is not guaranteed to be flushed before the next paint.
     So the positions are written straight onto the SVG instead. A scroll
     handler runs BEFORE paint, so an attribute set here is composited in the
     same frame as the scroll that caused it. Structure (which branches exist,
     what colour they are) still comes from React; only the coordinates are
     written by hand, and both sides go through laneGeom so they cannot
     disagree. State catches up when the scrolling stops. */
  const paint = useCallback(() => {
    const next = measureLanes();
    for (const key of Object.keys(next)) {
      const line = next[key];
      const laneEl = laneEls.current.get(key);
      const svg = laneEl && laneEl.querySelector("svg");
      if (!svg || !line.kids.length) continue;
      const g = laneGeom(line);
      svg.setAttribute("height", String(line.h));
      /* A gutter lane's branches are inside the column and scroll themselves —
         only the stem and its joint are still ours to move. */
      const byId = line.gutter ? new Map() : new Map(g.branches.map((b) => [b.id, b]));
      svg.querySelectorAll("[data-org]").forEach((n) => {
        const part = n.dataset.org;
        if (part === "stem") n.setAttribute("d", g.stemD);
        else if (part === "trunk") n.setAttribute("d", g.trunkD);
        else if (part === "joint") n.setAttribute("cy", String(g.y1));
        else {
          const b = byId.get(n.dataset.id);
          if (!b) return;
          if (part === "branch") n.setAttribute("d", b.d);
          else if (part === "dot") n.setAttribute("cy", String(b.y));
        }
      });
    }
  }, [measureLanes]);

  // After every render (a column opened, the pane resized, a search). measure
  // may leave state stale for a frame mid-scroll; paint runs after it, and
  // layout effects run before paint, so the hand-written coordinates always
  // win over anything React just wrote from an older measurement.
  useLayoutEffect(() => { measure(); paint(); });

  const frame = useRef(0);
  const measureSoon = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  /* Scrolling: draw now, reconcile later. The settle is what puts the state
     back in step once the wheel stops, so a later structural render starts
     from the truth rather than from wherever the lines were when scrolling
     began. */
  const settle = useRef(0);
  const onScrollSync = useCallback(() => {
    paint();
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(measure, 120);
  }, [paint, measure]);

  useEffect(() => {
    window.addEventListener("resize", measureSoon);
    return () => {
      window.removeEventListener("resize", measureSoon);
      cancelAnimationFrame(frame.current);
      window.clearTimeout(settle.current);
    };
  }, [measureSoon]);

  // ---- a newly opened level comes into view, without moving anything else --
  const paneRef = useRef(null);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Sideways: show the deepest column if it is past the right edge.
    if (pane.scrollWidth > pane.scrollLeft + pane.clientWidth + 1) {
      pane.scrollTo({ left: pane.scrollWidth - pane.clientWidth, behavior: reduce ? "auto" : "smooth" });
    }
    // Up and down: a search may open someone scrolled out of their column.
    opened.forEach((n) => {
      const el = cardEls.current.get(n.id);
      const col = el?.parentElement;
      if (!el || !col || col.scrollHeight <= col.clientHeight) return;
      const top = el.offsetTop - col.offsetTop;
      if (top < col.scrollTop || top + el.offsetHeight > col.scrollTop + col.clientHeight) {
        col.scrollTo({ top: top - (col.clientHeight - el.offsetHeight) / 2, behavior: reduce ? "auto" : "smooth" });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  return (
    <div ref={boxRef} className="relative -mx-4" data-testid="team-tree">
      <div
        ref={paneRef}
        role="region"
        aria-label="Team org chart"
        onScroll={onScrollSync}
        className="flex overflow-x-auto overflow-y-hidden overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: boxH }}
      >
        {owners.length > 0 && <RootColumn owners={owners} ctx={ctx} register={registerCard} />}
        {columns.map((items, i) => (
          <Fragment key={i === 0 ? "heads" : opened[i - 1].id}>
            {(i > 0 || owners.length > 0) && (
              <ConnectorLane laneKey={`lane-${i}`} line={lines[`lane-${i}`]} register={registerLane} stemOnly={scrolls[i]} />
            )}
            <LevelColumn items={items} add={adds[i]} index={i} height={boxH} ctx={ctx} register={registerCard}
              onScroll={onScrollSync} gutter={scrolls[i]} line={lines[`lane-${i}`]}
              registerContent={(el) => registerLane(`content-${i}`, el)} />
          </Fragment>
        ))}
        {/* Room past the deepest column, so its cards never sit on the pane's edge. */}
        <div aria-hidden="true" className="w-8 shrink-0" />
      </div>
    </div>
  );
}
