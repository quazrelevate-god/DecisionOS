// Finance — deleting records, and putting them back (2026-10-22, client: "the
// records were not correct and they need to refill them from Tally, and they
// have no way to delete").
//
// One record, a selection, an import undone, or everything: each asks the
// server first what it will do (POST …/preview — what goes with it, what
// changes on what stays, which issued GST invoices are kept) and shows that
// before anything goes. Every delete can be put back for 30 days — from the
// toast's Undo, or Finance › ⋯ › Recently deleted. The rules live in
// backend services/finance_trash.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowCounterClockwise, CheckCircle, ClockCounterClockwise, DotsThree, DownloadSimple, Trash, WarningCircle, X,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api, { API, formatApiError } from "../../lib/api";
import { downloadFrom } from "../../lib/native/files";
import { timeAgo, shortDate } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { DesignCheckbox } from "../../components/neuglass/DesignCheckbox";
import { GLASS_ICON_BTN, GLASS_MENU, GLASS_MENU_ITEM, GLASS_PILL, INK_PILL } from "../../components/neuglass/glass";
import { FIELD, SHEET_CONTENT, SMALL_PILL, SheetHead, Tag, fmt } from "./financeKit";

const errText = (e, fallback) => formatApiError(e?.response?.data?.detail) || fallback;
const DANGER = "bg-rose-600 text-white shadow-[0_12px_26px_-12px_hsl(350_80%_30%/0.6)] transition-[filter] hover:brightness-110";
const BOOKS = ["ledger-summary", "expenses", "assets", "inventory", "revenue", "payables",
  "ingestions", "captures", "captures-pending", "finance-trash", "tasks"];

export function useRefreshBooks() {
  const qc = useQueryClient();
  return () => BOOKS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/** Put a delete back. Used by the toast's Undo, Recently deleted and an undone import. */
export async function restoreBatch(batchId, refresh) {
  try {
    const { data } = await api.post(`/finance/trash/${batchId}/restore`);
    toast.success(`Put back ${data.label || "what was deleted"}`);
    refresh?.();
    return true;
  } catch (e) {
    toast.error(errText(e, "Couldn't put it back"));
    return false;
  }
}

/* ── selecting ──────────────────────────────────────────────────────────── */

/** One selection per tab at a time: the lists in a tab share `group`
    (useState(null)), so starting one stops the other. */
export function useSelection(rows, kindOf, name, group) {
  const [active, setActive] = group;
  const on = active === name;
  const [ids, setIds] = useState(() => new Set());
  useEffect(() => { if (!on) setIds((s) => (s.size ? new Set() : s)); }, [on]);
  // A row that leaves the list (deleted, filtered out) leaves the selection.
  useEffect(() => {
    setIds((prev) => {
      const live = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);
  return {
    on,
    start: () => setActive(name),
    stop: () => setActive(null),
    has: (row) => ids.has(row.id),
    toggle: (row) => setIds((prev) => {
      const n = new Set(prev);
      if (n.has(row.id)) n.delete(row.id); else n.add(row.id);
      return n;
    }),
    all: rows.length > 0 && rows.every((r) => ids.has(r.id)),
    toggleAll: () => setIds((prev) => (rows.every((r) => prev.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id)))),
    count: ids.size,
    items: () => rows.filter((r) => ids.has(r.id)).map((r) => ({ kind: kindOf(r), id: r.id })),
  };
}

/** "Select" on a list's header; the bar takes over once it is on. */
export function SelectToggle({ sel, rows, testid }) {
  if (!rows?.length || sel.on) return null;
  return (
    <button type="button" onClick={sel.start} data-testid={testid} className={SMALL_PILL}>
      <CheckCircle size={14} aria-hidden="true" /> Select
    </button>
  );
}

/** The bar above the dock while a list is being selected. */
export function SelectionBar({ sel, onDelete, testid = "finance-select-bar" }) {
  if (!sel.on) return null;
  return (
    <div role="toolbar" aria-label="Selected records" data-testid={testid}
      className={cn(
        "fixed inset-x-3 z-[60] flex items-center gap-1.5 rounded-pill p-1.5 pl-4",
        // Above the dock on a phone — the dock's own anchor (safe area in it)
        // plus its own height, plus a seam; at the foot of the page on a laptop.
        "bottom-[calc(var(--dock-bottom,0.5rem)+var(--desk-slider-track,6rem)+0.625rem)] lg:bottom-6 lg:left-1/2 lg:right-auto lg:-translate-x-1/2",
        INK_PILL,
      )}>
      <span className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums lg:flex-none lg:pr-2" aria-live="polite">
        {sel.count} selected
      </span>
      <button type="button" onClick={sel.toggleAll} data-testid={`${testid}-all`}
        className="h-9 shrink-0 rounded-pill px-3 text-xs font-medium text-white/85 hover:bg-white/10">
        {sel.all ? "Clear" : "Select all"}
      </button>
      <button type="button" onClick={onDelete} disabled={!sel.count} data-testid={`${testid}-delete`}
        className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-xs font-semibold disabled:opacity-40", DANGER)}>
        <Trash size={14} aria-hidden="true" /> Delete
      </button>
      <button type="button" onClick={sel.stop} aria-label="Stop selecting" data-testid={`${testid}-done`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/80 hover:bg-white/10">
        <X size={15} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ── asking first ───────────────────────────────────────────────────────── */

/**
 * The delete flow for a page: `ask(items)` or `askImport(upload)` opens the
 * confirmation; `dialog` renders it. `onDone` runs after a delete goes through.
 */
/* 2026-10-29 (founder: a delete must not take long) — the rows somebody
   picked leave the lists the moment the server says they are gone, instead
   of after every list has been fetched again (1-2 s more, with the row still
   sitting there). The refetch that follows brings the rest: a payment that
   went with an invoice, a balance that changed. */
function dropFromLists(qc, items) {
  const ids = new Set((items || []).map((i) => i.id));
  if (!ids.size) return;
  const drop = (rows) => (Array.isArray(rows) ? rows.filter((r) => !ids.has(r.id)) : rows);
  ["expenses", "assets", "inventory"].forEach((k) => qc.setQueryData([k], drop));
  qc.setQueryData(["revenue"], (d) => (d ? { ...d, invoices: drop(d.invoices), payments: drop(d.payments) } : d));
}

export function useFinanceDelete(onDone) {
  const refresh = useRefreshBooks();
  const qc = useQueryClient();
  const [req, setReq] = useState(null);   // { items, after } | { upload }
  const dialog = (
    <DeleteConfirmDialog req={req} onOpenChange={(o) => !o && setReq(null)}
      onDone={(data) => {
        req?.after?.();
        dropFromLists(qc, req?.items);
        setReq(null);
        refresh();
        onDone?.(data);
        toast.success(data.message || "Deleted", {
          duration: 9000,
          action: { label: "Undo", onClick: () => restoreBatch(data.batch_id, refresh) },
        });
      }} />
  );
  return {
    // `after` runs once the delete has gone through (a selection stops).
    ask: (items, after) => items?.length && setReq({ items, after }),
    askImport: (upload) => setReq({ upload }),
    dialog,
  };
}

function Parts({ parts }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {parts.map((p) => <Tag key={p.key} className="normal-case">{p.label}</Tag>)}
    </span>
  );
}

function DeleteConfirmDialog({ req: asked, onOpenChange, onDone }) {
  const open = !!asked;
  // The last request stays drawn while the sheet animates shut, so closing
  // does not flash an empty "Delete?".
  const last = useRef(asked);
  if (asked) last.current = asked;
  const req = asked || last.current;
  const forImport = !!req?.upload;
  const [includeIssued, setIncludeIssued] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setIncludeIssued(false); }, [open]);

  const previewQ = useQuery({
    queryKey: ["finance-delete-preview", forImport ? req?.upload?.id : req?.items, includeIssued],
    queryFn: () => (forImport
      ? api.post(`/finance/imports/${req.upload.id}/undo/preview`)
      : api.post("/finance/delete/preview", { items: req.items, include_issued: includeIssued })).then((r) => r.data),
    enabled: open,
    gcTime: 0,
    retry: false,
  });
  const p = previewQ.data;

  const go = async () => {
    setBusy(true);
    try {
      const { data } = forImport
        ? await api.post(`/finance/imports/${req.upload.id}/undo`)
        : await api.post("/finance/delete", { items: req.items, include_issued: includeIssued });
      onDone(data);
    } catch (e) {
      toast.error(errText(e, "Couldn't delete that"));
    } finally {
      setBusy(false);
    }
  };

  const nothing = p && p.total === 0;
  const kept = p?.kept_issued || [];
  const title = forImport ? "Undo this import?" : p ? `Delete ${p.label}?` : "Delete?";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-md")} data-testid="finance-delete-dialog">
        <SheetHead icon={forImport ? ArrowCounterClockwise : Trash} title={title}
          description={forImport ? `Takes out everything ${req?.upload?.filename ? `“${req.upload.filename}”` : "this upload"} filed, so you can import it again.` : ""}
          onClose={() => onOpenChange(false)} />
        <div className="space-y-4 px-6 pb-5 text-sm text-slate-700">
          {previewQ.isLoading && (
            <div className="space-y-2" aria-busy="true">
              <div className="ds-skeleton h-5 w-2/3 rounded-lg" />
              <div className="ds-skeleton h-5 w-1/2 rounded-lg" />
            </div>
          )}
          {previewQ.isError && (
            <p className="text-rose-700" data-testid="finance-delete-error">{errText(previewQ.error, "Couldn't check what this deletes.")}</p>
          )}
          {p && !nothing && (
            <>
              <div data-testid="finance-delete-asked">
                <p className="mb-1.5 text-xs font-medium text-slate-500">{forImport ? "Takes out" : "Deletes"}</p>
                <Parts parts={p.asked} />
              </div>
              {p.also?.length > 0 && (
                <div data-testid="finance-delete-also">
                  <p className="mb-1.5 text-xs font-medium text-slate-500">And with {p.asked.length === 1 && p.asked[0].n === 1 ? "it" : "them"}, because they belong together</p>
                  <Parts parts={p.also} />
                </div>
              )}
              {p.effects?.length > 0 && (
                <ul className="space-y-1.5" data-testid="finance-delete-effects">
                  {p.effects.map((e) => (
                    <li key={e} className="flex gap-2 text-[13px] leading-snug text-slate-600">
                      <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-400" />{e}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {p && nothing && kept.length === 0 && (
            <p data-testid="finance-delete-nothing">Nothing to delete — it may already be gone.</p>
          )}
          {kept.length > 0 && (
            <div className="rounded-2xl bg-amber-50/90 p-3.5 text-[13px] leading-snug text-amber-900 ring-1 ring-inset ring-amber-100" data-testid="finance-delete-kept">
              <p className="flex items-start gap-2 font-medium">
                <WarningCircle size={16} weight="bold" aria-hidden="true" className="mt-px shrink-0" />
                {kept.length === 1 ? "A GST invoice issued from DecisionOS is kept" : `${kept.length} GST invoices issued from DecisionOS are kept`}
              </p>
              <p className="mt-1.5 text-amber-800">
                {kept.slice(0, 3).map((k) => `#${k.number}`).join(", ")}{kept.length > 3 ? ` and ${kept.length - 3} more` : ""}.
                {" "}An issued GST invoice is a tax document your buyer already has. To cancel one, issue a credit note.
              </p>
              {p.can_include_issued && (
                <div className="mt-3">
                  <DesignCheckbox checked={includeIssued} onChange={(e) => setIncludeIssued(e.target.checked)} testid="finance-delete-include-issued">
                    Delete {kept.length === 1 ? "it" : "them"} anyway. The number won't be used again.
                  </DesignCheckbox>
                </div>
              )}
            </div>
          )}
          {p && !nothing && (
            <p className="flex items-start gap-2 text-xs text-slate-500">
              <ClockCounterClockwise size={14} aria-hidden="true" className="mt-px shrink-0" />
              You can put {forImport ? "it" : "this"} back for {p.restore_days} days: Finance › ⋯ › Recently deleted.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-900/[0.06] px-6 py-4">
          <button type="button" onClick={() => onOpenChange(false)}
            className={`h-11 rounded-pill px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
            Cancel
          </button>
          <button type="button" onClick={go} disabled={busy || !p || nothing} data-testid="finance-delete-confirm"
            className={cn("h-11 rounded-pill px-6 text-sm font-semibold disabled:opacity-50", DANGER)}>
            {busy ? "Deleting…" : forImport ? "Undo import" : p ? `Delete ${p.total === 1 ? "it" : p.total}` : "Delete"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── recently deleted ───────────────────────────────────────────────────── */

export function RecentlyDeletedDialog({ open, onOpenChange }) {
  const refresh = useRefreshBooks();
  const [busy, setBusy] = useState(null);
  const q = useQuery({
    queryKey: ["finance-trash"],
    queryFn: () => api.get("/finance/trash").then((r) => r.data),
    enabled: open,
  });
  const rows = q.data?.batches || [];
  const putBack = async (b) => {
    setBusy(b.id);
    await restoreBatch(b.id, refresh);
    setBusy(null);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-lg")} data-testid="finance-trash-dialog">
        <SheetHead icon={ClockCounterClockwise} title="Recently deleted"
          description={`Anything deleted in Finance can be put back for ${q.data?.restore_days || 30} days.`}
          onClose={() => onOpenChange(false)} />
        <div className="px-6 pb-6">
          {q.isLoading ? (
            <div className="space-y-2" aria-busy="true">{[0, 1].map((i) => <div key={i} className="ds-skeleton h-16 rounded-2xl" />)}</div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500" data-testid="finance-trash-empty">Nothing deleted in the last {q.data?.restore_days || 30} days.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((b) => (
                <li key={b.id} data-testid={`finance-trash-${b.id}`}
                  className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-white/70 p-3 ring-1 ring-inset ring-slate-900/[0.05]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900 first-letter:uppercase">{b.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {b.deleted_by_name || "Someone"} · {timeAgo(b.deleted_at)}
                      {b.status === "removed" && b.restore_until ? ` · until ${shortDate(b.restore_until.slice(0, 10))}` : ""}
                    </p>
                  </div>
                  {b.status === "restored" ? (
                    <Tag tone="good" className="normal-case">put back</Tag>
                  ) : (
                    <button type="button" disabled={busy === b.id} onClick={() => putBack(b)}
                      data-testid={`finance-trash-restore-${b.id}`} className={SMALL_PILL}>
                      <ArrowCounterClockwise size={14} aria-hidden="true" /> {busy === b.id ? "Putting back…" : "Put back"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── everything ─────────────────────────────────────────────────────────── */

/** The books as a spreadsheet, through a one-time link (fetching it is what
    unlocks Delete everything): a download in a browser, the share sheet in the
    app (lib/native/files). Resolves the export, or null when it failed. */
export async function downloadFinanceCopy() {
  const { data } = await api.post("/finance/export-link");
  const url = `${API.replace(/\/api$/, "")}${data.path}`;
  const ok = await downloadFrom(url, null, { failed: "Couldn't download the copy. Try again." });
  return ok ? data : null;
}

export function DeleteEverythingDialog({ open, onOpenChange, cur }) {
  const refresh = useRefreshBooks();
  const [includeIssued, setIncludeIssued] = useState(false);
  const [exportId, setExportId] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setIncludeIssued(false); setExportId(null); setName(""); } }, [open]);
  const q = useQuery({
    queryKey: ["finance-everything", includeIssued],
    queryFn: () => api.get("/finance/everything/preview", { params: { include_issued: includeIssued } }).then((r) => r.data),
    enabled: open,
    gcTime: 0,
  });
  const p = q.data;
  const kept = p?.kept_issued || [];
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const nameOk = !!p?.company_name && norm(name) === norm(p.company_name);
  const f = useMemo(() => fmt(cur || "INR"), [cur]);

  const copy = async () => {
    try {
      const data = await downloadFinanceCopy();
      if (data) setExportId(data.export_id);
    } catch (e) {
      toast.error(errText(e, "Couldn't make the download"));
    }
  };
  const go = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/finance/everything/delete", {
        confirm_name: name, export_id: exportId, include_issued: includeIssued });
      onOpenChange(false);
      refresh();
      toast.success(data.message || "Deleted all Finance records", {
        duration: 12000,
        action: { label: "Undo", onClick: () => restoreBatch(data.batch_id, refresh) },
      });
    } catch (e) {
      toast.error(errText(e, "Couldn't delete everything"));
    } finally {
      setBusy(false);
    }
  };
  const step = "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-md")} data-testid="finance-everything-dialog">
        <SheetHead icon={Trash} title="Delete all Finance records?"
          description="For starting the books again — from Tally, say. Contacts, tasks and requests are not touched."
          onClose={() => onOpenChange(false)} />
        <div className="space-y-5 px-6 pb-5 text-sm text-slate-700">
          {q.isLoading ? (
            <div className="ds-skeleton h-16 rounded-2xl" aria-busy="true" />
          ) : p ? (
            <div data-testid="finance-everything-counts">
              <p className="mb-1.5 text-xs font-medium text-slate-500">Deletes</p>
              {p.total ? <Parts parts={[...p.asked, ...(p.also || [])]} /> : <p>There are no Finance records to delete.</p>}
            </div>
          ) : null}
          {kept.length > 0 && (
            <div className="rounded-2xl bg-amber-50/90 p-3.5 text-[13px] leading-snug text-amber-900 ring-1 ring-inset ring-amber-100">
              <p className="font-medium">
                {includeIssued ? "Issued GST invoices go too" : `${kept.length} GST invoice${kept.length === 1 ? "" : "s"} issued from DecisionOS ${kept.length === 1 ? "is" : "are"} kept, with ${kept.length === 1 ? "its" : "their"} payments`}
              </p>
              <p className="mt-1 text-amber-800">
                {includeIssued
                  ? "Their numbers won't be used again."
                  : `${kept.slice(0, 3).map((k) => `#${k.number} (${f(k.amount)})`).join(", ")}${kept.length > 3 ? ` and ${kept.length - 3} more` : ""}. Cancel an issued invoice with a credit note.`}
              </p>
              <div className="mt-3">
                <DesignCheckbox checked={includeIssued} onChange={(e) => setIncludeIssued(e.target.checked)} testid="finance-everything-include-issued">
                  Delete issued GST invoices too
                </DesignCheckbox>
              </div>
            </div>
          )}
          <ol className="space-y-4">
            <li className="flex items-start gap-3">
              <span className={cn(step, exportId ? "bg-emerald-600 text-white" : INK_PILL)}>{exportId ? <CheckCircle size={14} weight="bold" aria-hidden="true" /> : 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">Download a copy first</p>
                <p className="mt-0.5 text-xs text-slate-500">Every record, as a spreadsheet you can keep.</p>
                <button type="button" onClick={copy} data-testid="finance-everything-download" className={cn(SMALL_PILL, "mt-2")}>
                  <DownloadSimple size={14} aria-hidden="true" /> {exportId ? "Download again" : "Download copy (.xlsx)"}
                </button>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className={cn(step, nameOk ? "bg-emerald-600 text-white" : INK_PILL)}>{nameOk ? <CheckCircle size={14} weight="bold" aria-hidden="true" /> : 2}</span>
              <div className="min-w-0 flex-1">
                <label htmlFor="finance-everything-name" className="font-medium text-slate-900">
                  Type <span className="font-semibold">{p?.company_name || "your company's name"}</span> to confirm
                </label>
                <input id="finance-everything-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off"
                  data-testid="finance-everything-name" className={cn(FIELD, "mt-2")} placeholder={p?.company_name || ""} />
              </div>
            </li>
          </ol>
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <ClockCounterClockwise size={14} aria-hidden="true" className="mt-px shrink-0" />
            You can put everything back for 30 days: Finance › ⋯ › Recently deleted.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2.5 border-t border-slate-900/[0.06] px-6 py-4">
          <button type="button" onClick={() => onOpenChange(false)}
            className={`h-11 rounded-pill px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
            Cancel
          </button>
          <button type="button" onClick={go} disabled={busy || !exportId || !nameOk || !p?.total} data-testid="finance-everything-confirm"
            className={cn("h-11 rounded-pill px-6 text-sm font-semibold disabled:opacity-50", DANGER)}>
            {busy ? "Deleting…" : "Delete everything"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── the ⋯ on Finance ───────────────────────────────────────────────────── */

export function FinanceMoreMenu({ cur }) {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [trashOpen, setTrashOpen] = useState(false);
  const [everythingOpen, setEverythingOpen] = useState(false);
  // Opened a tick after the menu closes, so the menu handing focus back to its
  // button does not fight the dialog's focus trap (as NewWorkMenu does).
  const later = (fn) => setTimeout(() => fn(true), 0);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="More Finance actions" title="More" data-testid="finance-more" className={GLASS_ICON_BTN}>
            <DotsThree size={20} weight="bold" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} collisionPadding={12}
          className={`${GLASS_MENU} w-[min(17rem,calc(100vw-1.5rem))] p-1.5`} data-testid="finance-more-menu">
          <DropdownMenuItem onSelect={() => later(setTrashOpen)} data-testid="finance-more-trash" className={GLASS_MENU_ITEM}>
            <ClockCounterClockwise size={17} aria-hidden="true" /> Recently deleted
          </DropdownMenuItem>
          {isOwner && (
            <DropdownMenuItem onSelect={() => later(setEverythingOpen)} data-testid="finance-more-everything"
              className={cn(GLASS_MENU_ITEM, "text-rose-700 focus:text-rose-800 data-[highlighted]:text-rose-800")}>
              <Trash size={17} aria-hidden="true" /> Delete all Finance records…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <RecentlyDeletedDialog open={trashOpen} onOpenChange={setTrashOpen} />
      {isOwner && <DeleteEverythingDialog open={everythingOpen} onOpenChange={setEverythingOpen} cur={cur} />}
    </>
  );
}
