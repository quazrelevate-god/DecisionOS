/* The admin console's building blocks (2026-10-22, admin redesign).
 *
 * Thirteen section files each drew their own loading line, status badge,
 * table and confirm, in a monospace left over from the retired brutalist
 * style. They share these now: Urbanist text, the app's chips and glass
 * menus, one table (sort + paging, row opens a page), and the two questions a
 * risky action asks -- "why?" (ReasonDialog, written to the audit log) and
 * "type the name" (TypedConfirmDialog). */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Spinner, DotsThree, MagnifyingGlass, CaretUp, CaretDown, CaretLeft, CaretRight, ArrowUpRight,
  Buildings, User, ArrowRight,
} from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import api, { formatApiError } from "../../lib/api";
import { saveFile } from "../../lib/native/files";
import {
  CHIP, QUIET_CHIP, GLASS_MENU, GLASS_MENU_ITEM, GLASS_PILL, INK_PILL, DRAWER_FIELD,
} from "../../components/neuglass/glass";
import { CARD_BASE, ADMIN_H3 } from "./adminStyle";
import { planLabel } from "./adminLabels";

// --- who is looking ---------------------------------------------------------------------
export const AdminContext = createContext({ admin: null, canWrite: false, isSuper: false, go: () => {} });
export const useAdmin = () => useContext(AdminContext);

// --- formatting -------------------------------------------------------------------------
export const errText = (e) => formatApiError(e?.response?.data?.detail);

export function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return "0";
  const v = Number(n);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return v.toLocaleString("en-IN");
}

/* ₹, Indian grouping. Small sums (an AI call costs paise) keep two decimals. */
export function fmtInr(n) {
  const v = Number(n || 0);
  const digits = Math.abs(v) < 100 && v !== 0 ? 2 : 0;
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export const usdToInr = (usd, rate) => Number(usd || 0) * Number(rate || 84);
export const fmtUsd = (n) => `$${Number(n || 0).toFixed(Number(n || 0) < 1 ? 4 : 2)}`;

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function fmtAgo(iso) {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 0) {
    const ahead = -s;
    if (ahead < 3600) return "Within the hour";
    const end = new Date(); end.setHours(23, 59, 59, 999);
    if (d <= end) return "Later today";
    const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
    return days <= 1 ? "Tomorrow" : `In ${days} days`;
  }
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} days ago`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400 / 7)} weeks ago`;
  return fmtDate(iso);
}

// --- per-viewer conveniences --------------------------------------------------------------
export function usePersisted(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const raw = window.localStorage.getItem(`dos_admin_${key}`);
      return raw == null ? initial : JSON.parse(raw);
    } catch { return initial; }
  });
  const set = useCallback((next) => {
    setV((cur) => {
      const val = typeof next === "function" ? next(cur) : next;
      try { window.localStorage.setItem(`dos_admin_${key}`, JSON.stringify(val)); } catch { /* private window */ }
      return val;
    });
  }, [key]);
  return [v, set];
}

/* One GET, with the states a screen must tell apart: loading, failed, loaded. */
export function useAdminGet(url) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const live = useRef(true);
  const load = useCallback(async () => {
    if (!url) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const r = await api.get(url);
      if (live.current) setState({ data: r.data, error: null, loading: false });
    } catch (e) {
      if (live.current) setState((s) => ({ ...s, error: e, loading: false }));
    }
  }, [url]);
  useEffect(() => { live.current = true; load(); return () => { live.current = false; }; }, [load]);
  /* Show a change the moment the server accepts it; the reload that follows
     can take seconds against the hosted database. */
  const setData = useCallback((fn) => setState((s) => ({ ...s, data: typeof fn === "function" ? fn(s.data) : fn })), []);
  return { ...state, reload: load, setData };
}

// --- controls -----------------------------------------------------------------------------
const BTN_SIZE = { md: "h-10 px-4 text-sm gap-2", sm: "h-8 px-3 text-xs gap-1.5" };
const BTN_VARIANT = {
  primary: INK_PILL,
  quiet: `${GLASS_PILL} text-slate-700 hover:bg-white`,
  danger: "bg-white text-[#b91c1c] ring-1 ring-inset ring-[#cf222e]/30 hover:bg-[#cf222e]/[0.06]",
  ghost: "text-slate-600 hover:bg-slate-900/[0.05] hover:text-slate-900",
};
export function Btn({ variant = "quiet", size = "md", icon: Icon, busy = false, children, className = "", type = "button", ...rest }) {
  return (
    <button type={type} {...rest} disabled={busy || rest.disabled}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-pill font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:cursor-not-allowed disabled:opacity-50 ${BTN_SIZE[size]} ${BTN_VARIANT[variant]} ${className}`}>
      {busy ? <Spinner size={size === "sm" ? 13 : 15} className="animate-spin" /> : Icon ? <Icon size={size === "sm" ? 13 : 15} /> : null}
      {children}
    </button>
  );
}

const TONE = {
  neutral: QUIET_CHIP,
  good: "bg-emerald-600/[0.08] text-[#116329] ring-emerald-700/15",
  warn: "bg-amber-500/[0.11] text-[#7d4e00] ring-amber-700/15",
  bad: "bg-[#cf222e]/[0.07] text-[#b91c1c] ring-[#cf222e]/20",
  info: "bg-sky-600/[0.08] text-[#0b5394] ring-sky-700/15",
};
export function Chip({ tone = "neutral", children, title, testid }) {
  return <span title={title} data-testid={testid} className={`${CHIP} ${TONE[tone] || TONE.neutral}`}>{children}</span>;
}
export const statusChip = (suspended) =>
  suspended ? <Chip tone="bad">Suspended</Chip> : <Chip tone="good">Active</Chip>;
export function planChip(plan) {
  const tone = { trial: "warn", business: "info", enterprise: "info", starter: "info" }[plan] || "neutral";
  return <Chip tone={tone}>{planLabel(plan)}</Chip>;
}

export function SearchField({ value, onChange, placeholder = "Search", testid, className = "", autoFocus }) {
  return (
    <label className={`relative flex min-w-0 items-center ${className}`}>
      <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 text-slate-500" aria-hidden="true" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        aria-label={placeholder} data-testid={testid} autoFocus={autoFocus} type="search"
        className="h-10 w-full rounded-pill bg-white/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 ring-1 ring-inset ring-slate-900/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25" />
    </label>
  );
}

export function Segmented({ value, onChange, options, testid, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} data-testid={testid}
      className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-pill bg-slate-500/[0.08] p-1 ring-1 ring-inset ring-slate-900/[0.04]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on}
            data-testid={testid ? `${testid}-${o.value || "all"}` : undefined}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 ${
              on ? "bg-white text-slate-900 shadow-[0_2px_8px_-4px_hsl(216_30%_25%/0.45)]" : "text-slate-600 hover:text-slate-900"}`}>
            {o.label}
            {o.count != null && <span className={`tabular-nums text-[11px] ${on ? "text-slate-500" : "text-slate-400"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, testid, disabled }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 ${disabled ? "cursor-not-allowed opacity-60" : ""}`}>
      {/* On a phone index.css grows every switch to a 44px touch target; the
          track is drawn inside it so it stays a switch, not a black disc. */}
      <button type="button" role="switch" aria-checked={!!checked} disabled={disabled} data-testid={testid}
        onClick={() => onChange(!checked)}
        className="group -my-1 inline-flex shrink-0 items-center justify-center rounded-full py-1 focus:outline-none">
        <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-neutral-900/30 ${checked ? "bg-ng-ink" : "bg-slate-400/40"}`}>
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </span>
      </button>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-slate-800">{label}</span>}
          {hint && <span className="block text-xs text-slate-500">{hint}</span>}
        </span>
      )}
    </label>
  );
}

/* "⋯" — where a row's or a page's less-common and riskier actions live, so
   one slip on a long list cannot suspend or delete anything. */
export function RowMenu({ items, label = "More actions", testid, align = "end", trigger }) {
  const shown = items.filter((i) => i && !i.hidden);
  if (!shown.length) return null;
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        {trigger || (
          <button type="button" aria-label={label} title={label} data-testid={testid}
            onClick={(e) => e.stopPropagation()}
            className="grid h-8 w-8 place-items-center rounded-full text-slate-600 transition-colors hover:bg-slate-900/[0.06] hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 data-[state=open]:bg-slate-900/[0.06]">
            <DotsThree size={20} weight="bold" />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} collisionPadding={12}
          className={`${GLASS_MENU} min-w-[13rem] p-1.5`} onClick={(e) => e.stopPropagation()}>
          {shown.map((it, i) => (
            <div key={it.label}>
              {it.separatorBefore && i > 0 && <DropdownMenu.Separator className="mx-2 my-1 h-px bg-slate-900/[0.07]" />}
              <DropdownMenu.Item disabled={it.disabled} data-testid={it.testid}
                onSelect={() => it.onSelect?.()}
                className={`${GLASS_MENU_ITEM} ${it.danger ? "!text-[#b91c1c] data-[highlighted]:!bg-[#cf222e]/[0.07]" : ""}`}>
                {it.icon && <it.icon size={16} aria-hidden="true" />}
                <span className="min-w-0 flex-1">{it.label}</span>
              </DropdownMenu.Item>
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// --- layout ---------------------------------------------------------------------------------
export function AdminPage({ title, subtitle, actions, back, children, testid }) {
  return (
    <div data-testid={testid} className="min-w-0">
      {back && (
        <button type="button" onClick={back.onClick}
          className="mb-3 inline-flex items-center gap-1 rounded-pill text-sm text-slate-600 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25">
          <CaretLeft size={14} /> {back.label}
        </button>
      )}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.65rem] leading-tight text-slate-900 [text-wrap:balance]">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Panel({ title, hint, actions, children, className = "", pad = true, testid, id }) {
  return (
    <section id={id} data-testid={testid} className={`${CARD_BASE} min-w-0 ${className}`}>
      {(title || actions) && (
        <div className={`flex flex-wrap items-center justify-between gap-2 ${pad ? "px-5 pt-4" : "px-5 py-4"}`}>
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={pad ? "p-5 pt-3" : ""}>{children}</div>
    </section>
  );
}

export function Loading({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500" role="status">
      <Spinner size={16} className="animate-spin" /> {label}
    </div>
  );
}

export function Empty({ icon: Icon, title, hint, action, testid, compact = false }) {
  return (
    <div data-testid={testid} className={`flex flex-col items-center text-center ${compact ? "py-6" : "py-12"}`}>
      {Icon && <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-slate-500/[0.08] text-slate-500"><Icon size={22} /></div>}
      <div className="text-sm font-medium text-slate-800">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-xs text-slate-500">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadError({ what = "this", onRetry }) {
  return (
    <div role="alert" className={`${CARD_BASE} flex flex-wrap items-center justify-between gap-3 p-5`}>
      <div>
        <div className="text-sm font-medium text-slate-900">Couldn&apos;t load {what}.</div>
        <div className="text-xs text-slate-500">The server didn&apos;t answer. Nothing was changed.</div>
      </div>
      {onRetry && <Btn size="sm" onClick={onRetry}>Try again</Btn>}
    </div>
  );
}

/* A number with what it means and how it moved. `good` says which way is
   good news ("up" for sign-ups, "down" for errors). */
export function Stat({ label, value, sub, change, good = "up", formatChange, onClick, testid, children }) {
  const hasChange = change != null && change !== 0;
  const better = hasChange && ((good === "up" && change > 0) || (good === "down" && change < 0));
  const body = (
    <>
      <div className={ADMIN_H3 + " mb-1.5"}>{label}</div>
      <div className="font-display text-[1.9rem] leading-none tabular-nums text-slate-900">{value}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {change != null && (
          <span className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${!hasChange ? "text-slate-500" : better ? "text-[#116329]" : "text-[#b91c1c]"}`}>
            {hasChange ? (change > 0 ? <CaretUp size={11} weight="fill" /> : <CaretDown size={11} weight="fill" />) : null}
            {hasChange ? `${change > 0 ? "+" : "−"}${formatChange ? formatChange(Math.abs(change)) : Math.abs(change)}` : "No change"}
          </span>
        )}
        {sub && <span>{sub}</span>}
      </div>
      {children}
    </>
  );
  const cls = `${CARD_BASE} block w-full min-w-0 p-5 text-left`;
  return onClick
    ? <button type="button" onClick={onClick} data-testid={testid} className={`${cls} transition-shadow hover:shadow-[0_14px_34px_-16px_hsl(0_0%_10%/0.35)] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25`}>{body}</button>
    : <div data-testid={testid} className={cls}>{body}</div>;
}

// --- the shared table -----------------------------------------------------------------------
/* columns: [{ key, label, render(row), sortValue(row), align: "right", mobile: false, className }]
   Search and filters belong to the screen (it knows what a row means); this
   sorts, pages and opens a row. */
export function DataTable({
  rows, columns, rowKey = "id", onRowClick, pageSize = 25, initialSort, empty, testid, rowTestid,
}) {
  const [sort, setSort] = useState(initialSort || null);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [rows]);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const val = col.sortValue || ((r) => r[col.key]);
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      // Nothing (never active, no date) goes last whichever way it is sorted.
      if (x == null || x === "") return y == null || y === "" ? 0 : 1;
      if (y == null || y === "") return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return String(x).localeCompare(String(y), "en", { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [rows, columns, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const shown = sorted.slice(cur * pageSize, cur * pageSize + pageSize);

  if (!rows.length) return empty || <Empty title="Nothing here yet." compact />;

  const flip = (c) => {
    if (c.sortable === false) return;
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.align === "right" ? "desc" : "asc" }));
  };
  const hide = (c) => (c.mobile === false ? "hidden md:table-cell" : "");

  return (
    <div data-testid={testid}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              {columns.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`border-b border-slate-900/[0.07] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500 ${c.align === "right" ? "text-right" : ""} ${hide(c)} ${c.className || ""}`}>
                    {c.label && c.sortable !== false ? (
                      <button type="button" onClick={() => flip(c)}
                        className={`inline-flex items-center gap-1 uppercase tracking-[0.1em] hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 ${on ? "text-slate-900" : ""}`}>
                        {c.label}
                        {on && (sort.dir === "asc" ? <CaretUp size={10} weight="fill" /> : <CaretDown size={10} weight="fill" />)}
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r[rowKey]} data-testid={rowTestid ? rowTestid(r) : undefined}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) onRowClick(r); } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={`group ${onRowClick ? "cursor-pointer focus:outline-none focus-visible:bg-slate-900/[0.04]" : ""} hover:bg-slate-900/[0.025]`}>
                {columns.map((c) => (
                  <td key={c.key}
                    className={`border-b border-slate-900/[0.05] px-4 py-3 align-middle text-slate-700 ${c.align === "right" ? "text-right tabular-nums" : ""} ${hide(c)} ${c.className || ""}`}>
                    {c.render ? c.render(r) : (r[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 text-xs text-slate-500">
          <span className="tabular-nums">{cur * pageSize + 1}–{Math.min(sorted.length, (cur + 1) * pageSize)} of {sorted.length}</span>
          <div className="flex items-center gap-1">
            <Btn size="sm" variant="ghost" icon={CaretLeft} disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</Btn>
            <Btn size="sm" variant="ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next <CaretRight size={13} /></Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// --- the two questions ----------------------------------------------------------------------
export function AdminDialog({ open, onOpenChange, title, description, children, busy, testid, wide = false }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent data-testid={testid} overlayClassName="bg-slate-900/30 backdrop-blur-[2px]"
        className={`border-0 bg-[linear-gradient(165deg,hsl(220_20%_98%),hsl(220_14%_94%))] p-6 shadow-[0_30px_80px_-20px_hsl(0_0%_0%/0.45)] ring-1 ring-inset ring-white/70 ${wide ? "max-w-xl" : "max-w-md"}`}>
        <div className="pr-6">
          <DialogTitle className="font-display text-xl font-normal leading-snug text-slate-900">{title}</DialogTitle>
          {description && <DialogDescription className="mt-2 text-sm leading-relaxed text-slate-600">{description}</DialogDescription>}
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

const FIELD = `${DRAWER_FIELD} text-sm`;
export const ADMIN_FIELD = FIELD;

/* "Why?" — asked before a suspend, a plan change, a view-as session. The
   answer goes into the audit log with the action. */
export function ReasonDialog({
  open, onOpenChange, title, description, label = "Reason", placeholder = "What happened, and who asked",
  required = true, confirmLabel, busyLabel, danger = false, busy = false, onConfirm, testid, children, initial = "",
  ready = true,
}) {
  const [reason, setReason] = useState(initial);
  useEffect(() => { if (open) setReason(initial); }, [open, initial]);
  const ok = ready && (!required || reason.trim().length >= 3);
  return (
    <AdminDialog open={open} onOpenChange={onOpenChange} title={title} description={description} busy={busy} testid={testid}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onConfirm(reason.trim()); }} className="mt-1 space-y-4">
        {children}
        <label className="block">
          <span className={ADMIN_H3 + " block"}>{label}{required ? "" : " (optional)"}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
            placeholder={placeholder} data-testid={testid ? `${testid}-reason` : undefined}
            className={`${FIELD} resize-none`} />
          <span className="mt-1 block text-xs text-slate-500">Saved in the audit log with this change.</span>
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Btn variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Btn>
          <Btn type="submit" variant={danger ? "danger" : "primary"} busy={busy} disabled={!ok}
            data-testid={testid ? `${testid}-go` : undefined}>
            {busy ? (busyLabel || "Working…") : confirmLabel}
          </Btn>
        </div>
      </form>
    </AdminDialog>
  );
}

/* "Type the name" — for what cannot be undone. */
export function TypedConfirmDialog({
  open, onOpenChange, title, description, phrase, confirmLabel, busyLabel, busy = false, onConfirm, testid, children,
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => { if (open) setTyped(""); }, [open]);
  const ok = typed.trim().toLowerCase() === String(phrase || "").trim().toLowerCase();
  return (
    <AdminDialog open={open} onOpenChange={onOpenChange} title={title} description={description} busy={busy} testid={testid}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onConfirm(); }} className="mt-1 space-y-4">
        {children}
        <label className="block">
          <span className="mb-2 block text-sm text-slate-700">Type <strong className="font-semibold text-slate-900">{phrase}</strong> to confirm</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off"
            placeholder={phrase} data-testid={testid ? `${testid}-input` : undefined} className={FIELD} />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Btn variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Btn>
          <Btn type="submit" variant="danger" busy={busy} disabled={!ok} data-testid={testid ? `${testid}-go` : undefined}>
            {busy ? (busyLabel || "Working…") : confirmLabel}
          </Btn>
        </div>
      </form>
    </AdminDialog>
  );
}

// --- Find (Ctrl K) --------------------------------------------------------------------------
/* Any workspace or person by name, email, phone or id — and any place in the
   console by its name — from anywhere. */
export function FindDialog({ open, onOpenChange, places, onGo }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (open) { setQ(""); setRes(null); setIdx(0); } }, [open]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(null); return undefined; }
    let gone = false;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/admin/search?q=${encodeURIComponent(term)}`);
        if (!gone) setRes(r.data);
      } catch { if (!gone) setRes({ tenants: [], users: [], failed: true }); }
      finally { if (!gone) setBusy(false); }
    }, 220);
    return () => { gone = true; clearTimeout(t); };
  }, [q]);

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = [];
    if (term) {
      places.filter((p) => p.label.toLowerCase().includes(term)).slice(0, 4)
        .forEach((p) => out.push({ kind: "place", key: `p-${p.key}`, label: p.label, sub: p.group || "Console", icon: p.icon, path: p.key }));
    }
    (res?.tenants || []).slice(0, 8).forEach((t) => out.push({
      kind: "workspace", key: `t-${t.id}`, label: t.name, icon: Buildings,
      sub: `${planLabel(t.plan)}${t.suspended ? " · Suspended" : ""}`, path: `workspaces/${t.id}`,
    }));
    (res?.users || []).slice(0, 8).forEach((u) => out.push({
      kind: "person", key: `u-${u.id}`, label: u.name || u.email || u.phone, icon: User,
      sub: [u.email || u.phone, u.tenant_name].filter(Boolean).join(" · "),
      path: u.tenant_id ? `workspaces/${u.tenant_id}` : "users",
    }));
    return out;
  }, [q, res, places]);
  useEffect(() => { setIdx(0); }, [items.length]);

  const pick = (it) => { onOpenChange(false); onGo(it.path); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    if (e.key === "Enter" && items[idx]) { e.preventDefault(); pick(items[idx]); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="admin-find" overlayClassName="bg-slate-900/30 backdrop-blur-[2px]"
        className="top-[18%] max-w-xl translate-y-0 gap-0 border-0 bg-[linear-gradient(165deg,hsl(220_20%_98%),hsl(220_14%_94%))] p-0 shadow-[0_30px_80px_-20px_hsl(0_0%_0%/0.45)] ring-1 ring-inset ring-white/70 data-[state=open]:slide-in-from-top-[2%]">
        <DialogTitle className="sr-only">Find</DialogTitle>
        <DialogDescription className="sr-only">Find a workspace, a person or a place in the console</DialogDescription>
        <div className="flex items-center gap-3 border-b border-slate-900/[0.07] px-5">
          {busy ? <Spinner size={18} className="animate-spin text-slate-500" /> : <MagnifyingGlass size={18} className="text-slate-500" />}
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} autoFocus
            placeholder="Find a workspace, a person, or a page…" data-testid="admin-find-input"
            role="combobox" aria-expanded={items.length > 0} aria-controls="admin-find-list"
            aria-activedescendant={items[idx] ? `find-${items[idx].key}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent pr-8 text-[15px] text-slate-900 placeholder:text-slate-400 focus:outline-none" />
        </div>
        <div id="admin-find-list" role="listbox" className="max-h-[min(26rem,60vh)] overflow-y-auto p-2">
          {q.trim().length < 2 && (
            <div className="px-3 py-6 text-center text-sm text-slate-500">
              Type a name, an email, a phone number or an id.
            </div>
          )}
          {q.trim().length >= 2 && !busy && items.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-slate-500">
              {res?.failed ? "Search didn't answer. Try again." : `Nothing matches “${q.trim()}”.`}
            </div>
          )}
          {items.map((it, i) => (
            <button key={it.key} id={`find-${it.key}`} type="button" role="option" aria-selected={i === idx}
              data-testid={`admin-find-${it.kind}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(it)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${i === idx ? "bg-slate-900/[0.06]" : ""}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-slate-600 ring-1 ring-inset ring-slate-900/[0.06]">
                {it.icon ? <it.icon size={16} /> : <ArrowRight size={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{it.label}</span>
                <span className="block truncate text-xs text-slate-500">{it.sub}</span>
              </span>
              <span className="text-[11px] text-slate-400">{it.kind === "place" ? "Page" : it.kind === "workspace" ? "Workspace" : "Person"}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-slate-900/[0.07] px-5 py-2.5 text-[11px] text-slate-500">
          <span><kbd className="font-sans">↑ ↓</kbd> to move</span><span><kbd className="font-sans">Enter</kbd> to open</span><span><kbd className="font-sans">Esc</kbd> to close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LinkOut({ onClick, children }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="inline-flex items-center gap-0.5 text-slate-900 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25">
      {children}<ArrowUpRight size={12} className="text-slate-400" />
    </button>
  );
}

/* Hand a JSON export over as a file — through lib/native/files, so it saves
   inside the app too, not only in a browser. Resolves true when it did. */
export async function downloadJSON(obj, name) {
  try {
    await saveFile(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), name);
    return true;
  } catch (e) {
    // The export arrived; it is the browser that could not hand it over as a file.
    console.error("admin: building the download failed", e);
    return false;
  }
}
