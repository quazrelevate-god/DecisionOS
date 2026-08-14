// MPWA-10 / MPWA-12g · /crm — mobile.
//
// The CRM is built two-column for desktop. §8: on mobile it becomes two SCREENS,
// not two columns — this is the list, /contacts/:id is the detail.
//
// MPWA-12g (§5.5), "the clearest grid win": it was "~125px per company for a
// name, a status chip and initials. Five rows fill a screen and say almost
// nothing." Now it is a 2-up Grid of 116px relationship tiles — twelve
// relationships per screen instead of five, each carrying the two facts he
// actually wants (what they owe, when he last touched them). Status became a
// coloured dot on the avatar rather than a chip owning its own row.
//
// Tapping a tile navigates. A contact 360 is a *place*, not an act (§2.2).
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  MagnifyingGlass, AddressBook, Users, Package, SlidersHorizontal, Check,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { inr, inrCompact } from "../../lib/format";
import { BottomSheet, EmptyState, ListSkeleton } from "../../components/mobile";
import { Grid, Pulse, Strip } from "../../components/mobile/blocks";

// Business language, not schema (§5.4): the API's `vendor` is a supplier.
const TYPES = [
  { key: "", label: "Everyone", icon: AddressBook },
  { key: "customer", label: "Customers", icon: Users },
  { key: "vendor", label: "Suppliers", icon: Package },
];
const STATUSES = [
  { key: "", label: "Any status" },
  { key: "active", label: "Active" },
  { key: "lead", label: "Leads" },
  { key: "inactive", label: "Dormant" },
];

const stageLabel = (s) =>
  s ? String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : null;

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Name, plus the company only when it says something new.
 *
 * Live data pairs "Gujarat Cotton Mills" with "Gujarat Cotton Mills Ltd", which
 * a naive `name !== company` check rendered as "Gujarat Cotton Mills — Gujarat
 * Cotton Mills Ltd" and then two-line-clamped it.
 */
export function contactTitle(c = {}) {
  const name = c.name || c.company || "";
  const co = c.company || "";
  if (!co) return name;
  const a = norm(name);
  const b = norm(co);
  if (!a || a === b || b.startsWith(a) || a.startsWith(b)) return name;
  return `${name} — ${co}`;
}

/** Initials for the avatar — two letters, from the words that carry meaning. */
export function initials(c = {}) {
  const src = c.name || c.company || "";
  const words = src
    .replace(/\b(ltd|limited|pvt|private|llp|inc|co|and|&|mills?|textiles?)\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  const pick = words.length ? words : src.split(/\s+/).filter(Boolean);
  return (pick[0]?.[0] || "?").toUpperCase() + (pick[1]?.[0] || "").toUpperCase();
}

/**
 * The stage, as a colour. §5.5: "Status becomes a coloured dot on the avatar, not
 * a chip owning its own row." Never colour alone — the dot carries a title and
 * the tile's aria-label spells it out (§3.5).
 */
const DOT = {
  at_risk: "bg-danger-600",
  inactive: "bg-neutral-400",
  key_account: "bg-success-600",
  lead: "bg-caution-500",
  active: "bg-brand-500",
};
function stageDot(c) {
  const key = c.lifecycle_stage || c.status || "active";
  return { cls: DOT[key] || "bg-brand-500", label: stageLabel(key) };
}

/** Days since the last touch, or null when there has never been one. */
function lastTouch(c) {
  const raw = c.last_contact_at || c.last_activity_at || c.updated_at;
  if (!raw) return null;
  const then = new Date(raw);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export default function CRMMobile() {
  const navigate = useNavigate();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // §5.5 celebrates "twelve relationships per screen"; a 60-contact book is
  // 4,700px of tiles, well past §5.2.7. Show a screenful and a bit, then let him
  // ask for more — search and the filters are right above, and that is how he
  // finds one specific person anyway.
  const [limit, setLimit] = useState(18);

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", status, q],
    queryFn: () =>
      api.get(`/contacts?type=&status=${status}&q=${encodeURIComponent(q)}`).then((r) => r.data),
  });

  const all = useMemo(() => (Array.isArray(data) ? data : data?.contacts || []), [data]);
  const rows = useMemo(() => (type ? all.filter((c) => c.type === type) : all), [all, type]);
  useEffect(() => setLimit(18), [type, status, q]);

  // §8: zero-count filters are noise — hide a type chip with nothing behind it.
  const counts = useMemo(
    () => ({
      "": all.length,
      customer: all.filter((c) => c.type === "customer").length,
      vendor: all.filter((c) => c.type === "vendor").length,
    }),
    [all]
  );

  // §5.5's Pulse: what the whole book owes, and the L3 counterweight — how many
  // relationships he actually touched this week. Both counted off the same list
  // on screen so they cannot drift from what he is looking at.
  const outstanding = useMemo(
    () => rows.reduce((n, c) => n + (Number(c.outstanding) || 0), 0),
    [rows]
  );
  const warmed = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000;
    return rows.filter((c) => {
      const raw = c.last_contact_at || c.last_activity_at;
      if (!raw) return false;
      const t = new Date(raw).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    }).length;
  }, [rows]);

  const activeStatus = STATUSES.find((s) => s.key === status) || STATUSES[0];

  return (
    <div data-testid="crm-mobile">
      <h1 className="font-heading text-2xl font-bold tracking-tight">People</h1>

      {/* A control sits above the content it filters (§5.2.3). */}
      <div className="relative mt-3">
        <MagnifyingGlass
          size={20}
          weight="bold"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          data-testid="crm-search"
          aria-label="Search people"
          placeholder="Search by name or company"
          className="w-full rounded-xl border border-input bg-card pl-10 pr-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ minHeight: "var(--control-h-base)" }}
        />
      </div>

      {/* §5.5: one chip row. The status filter used to be a second row of four
          pills — it folds into a sheet behind a Filter chip, which is also where
          §5.2.5's "no native select in the scroll path" is honoured. */}
      {/* §5.5 draws ONE row — `Everyone 4 · Customers 2 · Suppliers 2 · [Filter]`.
          Wrapping it (§5.2.1's rule for the Desk's four chips) took it to two
          rows at 390px, which is the 100px §5.3 complains about, on a different
          screen. It scrolls with a fade mask, like Money's tab strip. */}
      <Strip
        label="Who"
        data-testid="crm-filters"
        items={[
          ...TYPES.filter((t) => (counts[t.key] || 0) > 0 || t.key === type).map((t) => ({
            key: t.key || "all",
            label: t.label,
            icon: t.icon,
            count: counts[t.key] || 0,
            active: type === t.key,
            onSelect: () => setType(t.key),
          })),
          {
            key: "filter",
            label: status ? activeStatus.label : "Filter",
            icon: SlidersHorizontal,
            active: !!status,
            onSelect: () => setFiltersOpen(true),
          },
        ]}
      />

      {!isLoading && rows.length > 0 && (
        <Pulse
          data-testid="crm-pulse"
          stats={[
            {
              label: type === "vendor" ? "We owe" : "Outstanding",
              value: outstanding > 0 ? inrCompact(outstanding) : "₹0",
              series: [],
              tone: outstanding > 0 ? "danger" : "success",
              delta: null,
              invertDelta: true,
            },
            {
              // L3 for this screen (§3's table: "3 relationships warmed this
              // week"). Throughput — people he moved on, not a count of records.
              label: "Warmed this week",
              value: String(warmed),
              series: [],
              tone: "success",
              delta: null,
              progress: "relationships-warmed",
            },
          ]}
        />
      )}

      <div data-testid="crm-list">
        {isLoading && <ListSkeleton rows={4} />}

        {!isLoading && rows.length === 0 && (
          <EmptyState
            icon={AddressBook}
            title={q ? `Nobody matches “${q}”.` : "No one here yet."}
            hint={
              q
                ? "Try a shorter search — part of a name is enough."
                : "Your customers and suppliers land here as Dex reads your bills and invoices."
            }
            actionLabel={q ? "Clear the search" : "Tell Dex about a customer"}
            onAction={
              q ? () => setQ("") : () => window.dispatchEvent(new CustomEvent("dos:open-dex"))
            }
            data-testid="crm-empty"
          />
        )}

        {/* §5.5's tile: avatar with a stage dot, 2-line name, outstanding,
            last touch. A Grid because these are peers to scan and pick — never
            for ordered work (§9). */}
        <Grid
          items={rows.map((c) => ({ ...c, onOpen: () => navigate(`/contacts/${c.id}`) }))}
          max={limit}
          onSeeAll={() => setLimit((n) => n + 18)}
          data-testid="crm-grid"
          renderTile={(c) => {
            const dot = stageDot(c);
            const touch = lastTouch(c);
            return (
              <>
                <span className="flex items-start justify-between gap-2">
                  <span className="relative shrink-0">
                    <span
                      aria-hidden="true"
                      className="grid h-9 w-9 place-items-center rounded-pill bg-accent font-heading text-sm font-bold"
                    >
                      {initials(c)}
                    </span>
                    <span
                      title={dot.label || undefined}
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-pill border-2 border-card ${dot.cls}`}
                    />
                    <span className="sr-only">{dot.label}</span>
                  </span>
                  {c.outstanding > 0 && (
                    <span className="pt-0.5 text-right text-sm font-semibold tabular-nums text-danger-700">
                      {inr(c.outstanding)}
                    </span>
                  )}
                </span>
                <span className="mt-1.5 block font-heading text-[0.9375rem] font-semibold leading-snug tracking-tight line-clamp-2">
                  {contactTitle(c)}
                </span>
                <span className="mt-1 flex items-baseline justify-between gap-2 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
                  <span className="truncate">{c.city || c.person || dot.label}</span>
                  {touch && <span className="shrink-0 tabular-nums">{touch}</span>}
                </span>
              </>
            );
          }}
        />
      </div>

      {/* The folded second chip row (§5.5). A sheet, so the list keeps its
          height and the choice is a deliberate act. */}
      <BottomSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filter people"
        data-testid="crm-filter-sheet"
      >
        <ul className="space-y-2">
          {STATUSES.map((s) => (
            <li key={s.key || "any"}>
              <button
                type="button"
                onClick={() => {
                  setStatus(s.key);
                  setFiltersOpen(false);
                }}
                data-testid={`crm-status-${s.key || "any"}`}
                aria-pressed={status === s.key}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 text-left text-base font-semibold transition-colors ${
                  status === s.key ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card hover:bg-accent"
                }`}
                style={{ minHeight: "var(--control-h-md)" }}
              >
                {s.label}
                {status === s.key && <Check size={20} weight="bold" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}
