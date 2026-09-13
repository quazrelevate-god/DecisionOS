// 2026-09-14, founder · OrgTree — the Team page drawn as the organisation it
// is: the owner at the root, a branch per team (the tenant's roles), and each
// team's people hanging off a vertical line that ends in "Add member". Drawn
// from the founder's tree reference; its background is not part of the ask.
//
// Presentation only. TeamPanel owns the data, the search, who may add or edit,
// and the dialogs; the tree is told what to draw and whom to call.
//
// Desktop draws every connector: a stem out of the root, one rail across the
// teams with a rounded corner at each end, a joint and dot into each team,
// and a spine down each team with a twig and a dot into every card. Below lg
// a row of columns does not fit, so teams stack and only the spines remain.
import { forwardRef } from "react";
import {
  AirplaneTakeoff, Buildings, CaretRight, Code, Coins, Factory, Gear, Headset,
  IdentificationBadge, Megaphone, Plus, ShoppingCart, Truck, UsersThree,
} from "@phosphor-icons/react";
import { PersonAvatar } from "../../components/karma/PersonAvatar";
import { CHIP, QUIET_CHIP } from "../../components/karma/glass";

// A node: white glass lifted off the page. The connectors are a faint ink
// line; the dots are hollow, like the reference's joints.
const NODE = "rounded-[1.4rem] bg-white/80 ring-1 ring-inset ring-white shadow-[0_12px_32px_-16px_hsl(235_25%_25%/0.28),0_1px_2px_hsl(235_25%_25%/0.06)] backdrop-blur-xl";
const LINE = "bg-slate-900/[0.14]";
const LINE_BORDER = "border-slate-900/[0.14]";
const DOT = "h-2.5 w-2.5 rounded-full border-[1.5px] border-slate-400/70 bg-white";

export const MEMBER_STATUS = {
  active: { label: "Active", dot: "bg-emerald-500" },
  pending: { label: "Invite pending", dot: "bg-amber-400" },
  suspended: { label: "Inactive", dot: "bg-slate-400" },
};

// A team's glyph, read from its key and label so a tenant's own team names
// still find one; anything unrecognised is a building.
const TEAM_ICONS = [
  [/sales|business dev/i, UsersThree],
  [/production|manufactur|factory|plant/i, Factory],
  [/financ|account|billing|payment/i, Coins],
  [/operation|\bops\b/i, Gear],
  [/purchas|procure/i, ShoppingCart],
  [/market/i, Megaphone],
  [/support|service|customer/i, Headset],
  [/logistic|deliver|dispatch|warehouse/i, Truck],
  [/\bhr\b|human|talent|people/i, IdentificationBadge],
  [/tech|engineer|\bit\b|develop/i, Code],
];
export const teamIcon = (key = "", label = "") =>
  (TEAM_ICONS.find(([re]) => re.test(`${String(key).replace(/_/g, " ")} ${label}`)) || [null, Buildings])[1];

/* The order people sit in down a team's line: whoever others report to comes
   first, followed by their reports, and so on down (a depth-first walk of the
   reporting lines inside the team). Someone whose manager is in another team,
   or who has none, starts a line of their own. Ties go to whoever manages more
   people, then by name. A reporting loop cannot drop anyone: leftovers are
   appended. */
export function orderByReportingLine(list) {
  const ids = new Set(list.map((u) => u.id));
  const reports = new Map();
  list.forEach((u) => {
    const m = ids.has(u.reporting_manager_id) && u.reporting_manager_id !== u.id ? u.reporting_manager_id : null;
    if (!reports.has(m)) reports.set(m, []);
    reports.get(m).push(u);
  });
  const size = (u) => (reports.get(u.id) || []).length;
  const out = [];
  const seen = new Set();
  const walk = (managerId) => {
    [...(reports.get(managerId) || [])]
      .sort((a, b) => size(b) - size(a) || String(a.name || "").localeCompare(String(b.name || "")))
      .forEach((u) => {
        if (seen.has(u.id)) return;
        seen.add(u.id);
        out.push(u);
        walk(u.id);
      });
  };
  walk(null);
  list.forEach((u) => { if (!seen.has(u.id)) out.push(u); });
  return out;
}

/* One person. The root (the owner) is the same card, a size up. */
export function MemberNode({ u, title, access, isMe, outToday, dimmed, root = false, onOpen }) {
  const status = MEMBER_STATUS[u.invite_status] || MEMBER_STATUS.active;
  const away = outToday && status === MEMBER_STATUS.active;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`team-member-${u.id}`}
      aria-label={`Open profile for ${u.name}`}
      className={`block w-full text-left transition-[transform,box-shadow,opacity] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-18px_hsl(235_25%_25%/0.36),0_1px_2px_hsl(235_25%_25%/0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${NODE} ${root ? "p-5" : "p-4"} ${dimmed ? "opacity-55" : ""}`}
    >
      <div className="flex items-start gap-3">
        <PersonAvatar name={u.name} src={u.avatar_url} size={root ? 52 : 44} ring={false} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-slate-900">{u.name}</span>
            {isMe && (
              <span data-testid={`is-you-${u.id}`}
                className="shrink-0 rounded-md bg-slate-900/[0.06] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600">
                YOU
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-slate-600" data-testid={`member-title-${u.id}`}>{title}</p>
          <p className="truncate text-xs text-slate-500">{u.email}</p>
        </div>
      </div>
      <div className="mt-3.5 flex items-center justify-between gap-2">
        <span data-testid={`status-${u.id}`} className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-600">
          {away
            ? <AirplaneTakeoff size={12} weight="bold" aria-hidden="true" className="shrink-0 text-orange-500" />
            : <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} />}
          <span className="truncate">{away ? "Out today" : status.label}</span>
        </span>
        <span data-testid={`member-access-count-${u.id}`} className={`${CHIP} ${QUIET_CHIP}`}>{access}</span>
      </div>
    </button>
  );
}

/* The dashed tile at the end of a branch. forwardRef so it can be a Radix
   DialogTrigger (the add-member dialog, pre-set to this team). */
export const AddMemberTile = forwardRef(function AddMemberTile({ label = "Add member", ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className="flex h-12 w-full max-w-[14rem] items-center gap-3 rounded-2xl border border-dashed border-slate-900/[0.18] bg-white/45 px-4 text-sm font-medium text-slate-700 transition-colors hover:border-slate-900/30 hover:bg-white/75 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25"
    >
      <Plus size={16} weight="bold" aria-hidden="true" /> {label}
    </button>
  );
});

/* The piece above a team on desktop: its share of the rail and the drop into
   the team, with a dot where it lands. The first and last teams turn the rail
   down through a rounded corner; teams between take a T. The rail pokes half
   the column gap (gap-6) past each column so neighbours meet in the gap. */
function BranchJoint({ index, count }) {
  const first = index === 0;
  const last = index === count - 1;
  return (
    <div aria-hidden="true" className="relative hidden h-9 lg:block">
      {count === 1 ? (
        <span className={`absolute left-1/2 top-0 h-full w-px ${LINE}`} />
      ) : first ? (
        <span className={`absolute -right-3 left-1/2 top-0 h-full rounded-tl-[1.25rem] border-l border-t ${LINE_BORDER}`} />
      ) : last ? (
        <span className={`absolute -left-3 right-1/2 top-0 h-full rounded-tr-[1.25rem] border-r border-t ${LINE_BORDER}`} />
      ) : (
        <>
          <span className={`absolute -left-3 -right-3 top-0 h-px ${LINE}`} />
          <span className={`absolute left-1/2 top-0 h-full w-px ${LINE}`} />
        </>
      )}
      <span className={`absolute bottom-0 left-1/2 z-10 -translate-x-1/2 translate-y-1/2 ${DOT}`} />
    </div>
  );
}

/* One stop on a team's spine: the spine from the card above (or the team
   node) down to this card — only halfway for the last — then a twig and a dot
   into the card's middle. The list is pl-7, so the spine sits 10px in from the
   team node's left edge, under its rounded corner. */
function Twig({ last, children }) {
  return (
    <li className="relative">
      <span aria-hidden="true"
        className={`absolute -left-[1.125rem] -top-3 w-px ${LINE} ${last ? "h-[calc(50%+0.75rem)]" : "h-[calc(100%+0.75rem)]"}`} />
      <span aria-hidden="true" className={`absolute -left-[1.125rem] top-1/2 h-px w-[1.125rem] ${LINE}`} />
      <span aria-hidden="true" className={`absolute -left-[1.125rem] top-1/2 -translate-x-1/2 -translate-y-1/2 ${DOT}`} />
      {children}
    </li>
  );
}

/**
 * @param {object[]} owners        the root: every owner, side by side
 * @param {object[]} branches      { key, label, total, members } per team, in order
 * @param {function} isOpen        (teamKey) => whether the team's people show
 * @param {function} onToggle      (teamKey) => fold or unfold it
 * @param {boolean}  searching     while a search is on every team is open and cannot fold
 * @param {function} renderMember  (user, { root }) => the card
 * @param {function} renderAdd     (branch) => the "Add member" trigger, or null
 */
export function OrgTree({ owners = [], branches = [], isOpen, onToggle, searching = false, renderMember, renderAdd }) {
  const rooted = owners.length > 0;
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-10 lg:-mx-2 lg:px-2" data-testid="team-tree">
      <div className="flex w-full flex-col lg:mx-auto lg:w-max lg:min-w-full lg:items-center">
        {rooted && (
          <div className="flex flex-col gap-3 lg:flex-row lg:justify-center lg:gap-4" data-testid="team-root">
            {owners.map((u) => (
              <div key={u.id} className="w-full lg:w-[22rem]">{renderMember(u, { root: true })}</div>
            ))}
          </div>
        )}
        {rooted && branches.length > 0 && (
          <div aria-hidden="true" className={`relative mx-auto hidden h-9 w-px lg:block ${LINE}`}>
            <span className={`absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 ${DOT}`} />
          </div>
        )}

        <div className={`flex flex-col gap-6 lg:flex-row lg:items-start ${rooted ? "mt-6 lg:mt-0" : ""}`} data-testid="team-branches">
          {branches.map((b, i) => {
            const open = isOpen(b.key);
            const add = renderAdd ? renderAdd(b) : null;
            const Icon = teamIcon(b.key, b.label);
            const listId = `team-branch-list-${b.key}`;
            const count = b.members.length !== b.total
              ? `${b.members.length} of ${b.total} members`
              : `${b.total} ${b.total === 1 ? "member" : "members"}`;
            return (
              <section key={b.key} data-testid={`team-branch-${b.key}`} aria-label={`${b.label} team`}
                className="flex w-full shrink-0 flex-col lg:w-[17.5rem]">
                {rooted && <BranchJoint index={i} count={branches.length} />}
                <div className={`flex items-center gap-3 p-3 ${NODE}`} data-testid={`team-dept-${b.key}`}>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-900/[0.05] text-slate-700 ring-1 ring-inset ring-slate-900/[0.04]">
                    <Icon size={22} weight="regular" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-slate-900">{b.label}</p>
                    <p className="text-xs text-slate-500" data-testid={`team-dept-count-${b.key}`}>{count}</p>
                  </div>
                  <button type="button" onClick={() => onToggle(b.key)} disabled={searching}
                    aria-expanded={open} aria-controls={listId}
                    aria-label={`${open ? "Fold" : "Unfold"} ${b.label}`}
                    title={searching ? "Clear the search to fold teams" : undefined}
                    data-testid={`team-dept-toggle-${b.key}`}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/85 text-slate-600 ring-1 ring-inset ring-slate-900/[0.06] shadow-[0_4px_12px_-6px_hsl(235_25%_25%/0.35)] transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:cursor-default disabled:opacity-60">
                    <CaretRight size={14} weight="bold" aria-hidden="true"
                      className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
                  </button>
                </div>

                {open && (b.members.length > 0 || add) && (
                  <ol id={listId} className="relative mt-3 space-y-3 pl-7" data-testid={listId}>
                    {b.members.map((u, j) => (
                      <Twig key={u.id} last={j === b.members.length - 1 && !add}>{renderMember(u, { root: false })}</Twig>
                    ))}
                    {add && <Twig last>{add}</Twig>}
                  </ol>
                )}
                {open && b.members.length === 0 && !add && (
                  <p id={listId} className="mt-3 pl-7 text-xs text-slate-500">No one in this team yet.</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
