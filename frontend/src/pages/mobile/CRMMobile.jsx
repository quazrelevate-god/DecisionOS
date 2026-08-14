// MPWA-10 · /crm — mobile.
//
// The CRM is built two-column for desktop. §8: on mobile it becomes two
// SCREENS, not two columns — this is the list, /contacts/:id is the detail.
//
// Also removes the last native <select> outside Settings: the status filter was
// a picker sitting in the scroll path (§5.2.5).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlass, AddressBook, Users, Package } from "@phosphor-icons/react";
import api from "../../lib/api";
import { EmptyState, ListSkeleton, MobileCard } from "../../components/mobile";

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

export default function CRMMobile() {
  const navigate = useNavigate();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", status, q],
    queryFn: () =>
      api.get(`/contacts?type=&status=${status}&q=${encodeURIComponent(q)}`).then((r) => r.data),
  });

  const rows = useMemo(() => {
    const list = Array.isArray(data) ? data : data?.contacts || [];
    return type ? list.filter((c) => c.type === type) : list;
  }, [data, type]);

  // §8: zero-count filters are noise — hide a type chip with nothing behind it.
  const counts = useMemo(() => {
    const list = Array.isArray(data) ? data : data?.contacts || [];
    return {
      "": list.length,
      customer: list.filter((c) => c.type === "customer").length,
      vendor: list.filter((c) => c.type === "vendor").length,
    };
  }, [data]);

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

      {/* §5.2.1: chips wrap. The status filter used to be a native <select> in
          the scroll path — chips cannot be opened by a stray flick. */}
      <div className="mt-3 flex flex-wrap gap-touch-gap" data-testid="crm-filters">
        {TYPES.filter((t) => (counts[t.key] || 0) > 0 || t.key === type).map((t) => (
          <button
            key={t.key || "all"}
            type="button"
            onClick={() => setType(t.key)}
            data-testid={`crm-type-${t.key || "all"}`}
            aria-pressed={type === t.key}
            className={`flex items-center gap-1.5 rounded-pill border px-3 text-sm font-semibold transition-colors ${
              type === t.key
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent"
            }`}
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            <t.icon size={18} weight={type === t.key ? "fill" : "regular"} aria-hidden="true" />
            {t.label}
            <span className="text-[length:var(--text-label)] font-bold leading-4 tabular-nums opacity-70">
              {counts[t.key] || 0}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-touch-gap" data-testid="crm-status-filters">
        {STATUSES.map((s) => (
          <button
            key={s.key || "any"}
            type="button"
            onClick={() => setStatus(s.key)}
            data-testid={`crm-status-${s.key || "any"}`}
            aria-pressed={status === s.key}
            className={`rounded-pill border px-3 text-sm font-semibold transition-colors ${
              status === s.key
                ? "border-transparent bg-foreground text-background"
                : "border-border bg-card hover:bg-accent"
            }`}
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3" data-testid="crm-list">
        {isLoading && <ListSkeleton rows={4} />}
        {!isLoading && rows.length === 0 && (
          <EmptyState
            icon={AddressBook}
            title={q ? `Nobody matches "${q}".` : "No one here yet."}
            hint={q ? "Try a shorter search." : undefined}
            data-testid="crm-empty"
          />
        )}
        {rows.map((c) => (
          <MobileCard
            key={c.id}
            data-testid={`crm-row-${c.id}`}
            title={c.company && c.company !== c.name ? `${c.name} — ${c.company}` : c.name}
            status={
              c.lifecycle_stage === "at_risk" || c.status === "inactive"
                ? "overdue"
                : c.lifecycle_stage === "key_account"
                  ? "completed"
                  : "pending"
            }
            statusLabel={stageLabel(c.lifecycle_stage) || stageLabel(c.status) || undefined}
            person={c.person || c.name}
            context={[c.person, c.city].filter(Boolean).join(" · ") || null}
            // Outstanding right-aligned — the number he actually cares about
            // when scanning a customer list.
            amount={c.outstanding}
            onOpen={() => navigate(`/contacts/${c.id}`)}
          />
        ))}
      </div>
    </div>
  );
}
