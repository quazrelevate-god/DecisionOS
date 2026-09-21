// Finance — adding records (2026-09-14). The four dialogs are controlled from
// the page, so one "Add record" menu, a tab's own Add button and the phone's
// Quick capture "Add expense" all open the same dialog (the old phone button
// clicked a selector nothing carried — FN-08). Every choice is our own
// dropdown, never the operating system's list.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Buildings, CaretDown, CurrencyInr, Package, Plus, Receipt, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api from "../../lib/api";
import { lex } from "../../lib/lexicon";
import { useAuth } from "../../context/AuthContext";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { GlassSelect } from "../../components/karma/GlassSelect";
import { GLASS_MENU, GLASS_MENU_ITEM, INK_PILL } from "../../components/karma/glass";
import { AREA, FIELD, Field, FileField, SHEET_CONTENT, SheetFoot, SheetHead, fmt } from "./financeKit";
import { DraftNote } from "../../components/karma/DraftNote";
import { useDraft } from "../../hooks/useDraft";

const withCurrent = (list, value) => (value && !list.includes(value) ? [value, ...list] : list);

/* PILOT-1 A — KEEP. Every form here held its fields in state and emptied them
   on ANY close — the X, Escape, a click beside it — so an expense half-typed
   when someone stepped away to find the bill was gone. The fields are a draft
   now (lib/drafts.js): closing keeps them for the next time this form opens,
   and Cancel or Save is what empties it. The attached bill is not kept; a
   browser cannot store a file for later. */
const KEPT_LABEL = "Kept from before — not saved yet";

const formData = (fields, file) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v ?? ""));
  if (file) fd.append("file", file);
  return fd;
};

const EXPENSE_BLANK = { title: "", amount: "", vendor_name: "", category: "", date: "", status: "unpaid", notes: "" };

export function AddExpenseDialog({ open, onOpenChange, categories = [], onDone }) {
  const { t } = useTranslation();
  const { tenant } = useAuth();
  const L = lex(tenant);
  const uid = useId();
  const [f, setF, draft] = useDraft("expense", EXPENSE_BLANK);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  // PILOT-1 A — closing keeps what was typed (see KEEP below); Cancel and Save
  // are what empty the form.
  const close = () => onOpenChange(false);
  const cancel = () => { draft.discard(); setFile(null); onOpenChange(false); };

  const suggest = async () => {
    const text = `${f.title} ${f.vendor_name} ${f.notes}`.trim();
    if (!text) return toast.error(t("finance.add_title_first"));
    setSuggesting(true);
    try {
      const { data } = await api.post("/expenses/suggest-category", { text });
      set("category", data.category);
      toast.success(t("finance.ai_suggests", { category: data.category }));
    } catch {
      toast.error(t("finance.could_not_create"));
    } finally {
      setSuggesting(false);
    }
  };
  const save = async () => {
    if (!f.title.trim() && !f.amount && !file) return toast.error(t("finance.need_expense"));
    setBusy(true);
    try {
      await api.post("/expenses/with-file", formData(f, file));
      toast.success(file ? t("finance.added_bill") : t("finance.expense_added"));
      cancel();
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || t("finance.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-xl")} data-testid="expense-dialog">
        <SheetHead icon={Receipt} title={t("finance.new_expense")} description={t("finance.new_expense_desc")} onClose={close} />
        <div className="space-y-4 px-6 pb-5">
          {draft.restored && <DraftNote onDiscard={() => draft.discard()} label={KEPT_LABEL} testid="expense-draft" className="-mt-2" />}
          <FileField file={file} setFile={setFile} />
          <Field label={t("finance.c_title")} htmlFor={`${uid}-title`}>
            <input id={`${uid}-title`} data-testid="expense-title" className={FIELD} value={f.title}
              onChange={(e) => set("title", e.target.value)} placeholder={t("finance.exp_title_ph")} />
          </Field>
          {/* Five rows, not seven: the dialog fits a 900px-tall laptop without
              scrolling, and folds to two columns on a phone. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={t("finance.c_amount")} htmlFor={`${uid}-amount`}>
              <input id={`${uid}-amount`} data-testid="expense-amount" type="number" inputMode="decimal" className={FIELD}
                value={f.amount} onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <Field label={t("finance.f_status")} htmlFor={`${uid}-status`}>
              <GlassSelect id={`${uid}-status`} variant="field" triggerClassName={FIELD} testid="expense-status" ariaLabel={t("finance.f_status")}
                value={f.status} onChange={(v) => set("status", v)}
                options={[{ value: "unpaid", label: t("finance.unpaid") }, { value: "paid", label: t("finance.paid") }]} />
            </Field>
            <Field label={t("finance.c_date")} htmlFor={`${uid}-date`} className="col-span-2 sm:col-span-1">
              <input id={`${uid}-date`} type="date" className={FIELD} value={f.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("finance.f_vendor", { vendor: L.vendor_singular })} htmlFor={`${uid}-vendor`}>
              <input id={`${uid}-vendor`} data-testid="expense-vendor" className={FIELD} value={f.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} />
            </Field>
            <Field label={t("finance.c_category")} htmlFor={`${uid}-category`}
              aside={(
                <button type="button" onClick={suggest} disabled={suggesting} data-testid="expense-suggest-category"
                  className="flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-white/80 disabled:opacity-50">
                  <Sparkle size={13} weight="fill" aria-hidden="true" className="text-orange-500" />
                  {suggesting ? t("finance.thinking") : t("finance.ai_suggest")}
                </button>
              )}>
              <GlassSelect id={`${uid}-category`} variant="field" triggerClassName={FIELD} testid="expense-category" ariaLabel={t("finance.c_category")}
                value={f.category} onChange={(v) => set("category", v)}
                options={[{ value: "", label: t("finance.auto") }, ...withCurrent(categories, f.category).map((c) => ({ value: c, label: c }))]} />
            </Field>
          </div>
          <Field label={t("finance.f_notes")} htmlFor={`${uid}-notes`}>
            <textarea id={`${uid}-notes`} className={AREA} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        <SheetFoot onCancel={cancel} onSave={save} busy={busy} testid="expense-save" saveLabel={t("finance.save_expense")}
          busyLabel={file ? t("finance.ai_reading") : t("finance.saving")} />
      </DialogContent>
    </Dialog>
  );
}

const ASSET_BLANK = { name: "", purchase_amount: "", category: "Equipment", vendor_name: "", purchase_date: "", status: "active", notes: "" };

export function AddAssetDialog({ open, onOpenChange, categories = [], onDone }) {
  const { t } = useTranslation();
  const uid = useId();
  const [f, setF, draft] = useDraft("asset", ASSET_BLANK);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  // PILOT-1 A — closing keeps what was typed (see KEEP below); Cancel and Save
  // are what empty the form.
  const close = () => onOpenChange(false);
  const cancel = () => { draft.discard(); setFile(null); onOpenChange(false); };
  const save = async () => {
    if (!f.name.trim() && !file) return toast.error(t("finance.need_asset"));
    setBusy(true);
    try {
      await api.post("/assets/with-file", formData(f, file));
      toast.success(file ? t("finance.asset_added_bill") : t("finance.asset_added"));
      cancel();
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || t("finance.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-xl")} data-testid="asset-dialog">
        <SheetHead icon={Buildings} title={t("finance.new_asset")} description={t("finance.new_asset_desc")} onClose={close} />
        <div className="space-y-4 px-6 pb-5">
          {draft.restored && <DraftNote onDiscard={() => draft.discard()} label={KEPT_LABEL} testid="asset-draft" className="-mt-2" />}
          <FileField file={file} setFile={setFile} />
          <Field label={t("finance.asset_name")} htmlFor={`${uid}-name`}>
            <input id={`${uid}-name`} data-testid="asset-name" className={FIELD} value={f.name}
              onChange={(e) => set("name", e.target.value)} placeholder={t("finance.asset_name_ph")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.purchase_amount")} htmlFor={`${uid}-amount`}>
              <input id={`${uid}-amount`} data-testid="asset-amount" type="number" inputMode="decimal" className={FIELD}
                value={f.purchase_amount} onChange={(e) => set("purchase_amount", e.target.value)} />
            </Field>
            <Field label={t("finance.c_category")} htmlFor={`${uid}-category`}>
              <GlassSelect id={`${uid}-category`} variant="field" triggerClassName={FIELD} testid="asset-category" ariaLabel={t("finance.c_category")}
                value={f.category} onChange={(v) => set("category", v)}
                options={withCurrent(categories, f.category).map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
          <Field label={t("finance.c_vendor")} htmlFor={`${uid}-vendor`}>
            <input id={`${uid}-vendor`} className={FIELD} value={f.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.purchase_date")} htmlFor={`${uid}-date`}>
              <input id={`${uid}-date`} type="date" className={FIELD} value={f.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} />
            </Field>
            <Field label={t("finance.f_status")} htmlFor={`${uid}-status`}>
              <GlassSelect id={`${uid}-status`} variant="field" triggerClassName={FIELD} testid="asset-status" ariaLabel={t("finance.f_status")}
                value={f.status} onChange={(v) => set("status", v)}
                options={[
                  { value: "active", label: t("finance.active") },
                  { value: "maintenance", label: t("finance.maintenance") },
                  { value: "disposed", label: t("finance.disposed") },
                ]} />
            </Field>
          </div>
        </div>
        <SheetFoot onCancel={cancel} onSave={save} busy={busy} testid="asset-save" saveLabel={t("finance.save_asset")}
          busyLabel={file ? t("finance.ai_reading") : t("finance.saving")} />
      </DialogContent>
    </Dialog>
  );
}

const INVENTORY_BLANK = { item: "", sku: "", quantity: "", unit: "unit", unit_cost: "", category: "", vendor_name: "", notes: "" };

export function AddInventoryDialog({ open, onOpenChange, cur, onDone }) {
  const { t } = useTranslation();
  const uid = useId();
  const [f, setF, draft] = useDraft("inventory", INVENTORY_BLANK);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  // PILOT-1 A — closing keeps what was typed (see KEEP below); Cancel and Save
  // are what empty the form.
  const close = () => onOpenChange(false);
  const cancel = () => { draft.discard(); setFile(null); onOpenChange(false); };
  const value = (Number(f.quantity) || 0) * (Number(f.unit_cost) || 0);
  const save = async () => {
    if (!f.item.trim() && !file) return toast.error(t("finance.need_item"));
    setBusy(true);
    try {
      await api.post("/inventory/with-file", formData(f, file));
      toast.success(file ? t("finance.inv_added_bill") : t("finance.inv_added"));
      cancel();
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || t("finance.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-xl")} data-testid="inventory-dialog">
        <SheetHead icon={Package} title={t("finance.new_inv")} description={t("finance.new_inv_desc")} onClose={close} />
        <div className="space-y-4 px-6 pb-5">
          {draft.restored && <DraftNote onDiscard={() => draft.discard()} label={KEPT_LABEL} testid="inventory-draft" className="-mt-2" />}
          <FileField file={file} setFile={setFile} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.i_item")} htmlFor={`${uid}-item`}>
              <input id={`${uid}-item`} data-testid="inv-item" className={FIELD} value={f.item} onChange={(e) => set("item", e.target.value)} />
            </Field>
            <Field label={t("finance.i_sku")} htmlFor={`${uid}-sku`}>
              <input id={`${uid}-sku`} className={FIELD} value={f.sku} onChange={(e) => set("sku", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("finance.quantity")} htmlFor={`${uid}-qty`}>
              <input id={`${uid}-qty`} data-testid="inv-qty" type="number" inputMode="decimal" className={FIELD} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </Field>
            <Field label={t("finance.unit")} htmlFor={`${uid}-unit`}>
              <input id={`${uid}-unit`} className={FIELD} value={f.unit} onChange={(e) => set("unit", e.target.value)} />
            </Field>
            <Field label={t("finance.unit_cost")} htmlFor={`${uid}-cost`}>
              <input id={`${uid}-cost`} data-testid="inv-cost" type="number" inputMode="decimal" className={FIELD} value={f.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.c_category")} htmlFor={`${uid}-category`}>
              <input id={`${uid}-category`} className={FIELD} value={f.category} onChange={(e) => set("category", e.target.value)} />
            </Field>
            <Field label={t("finance.c_vendor")} htmlFor={`${uid}-vendor`}>
              <input id={`${uid}-vendor`} className={FIELD} value={f.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} />
            </Field>
          </div>
          {value > 0 && (
            <p className="text-sm text-slate-600" aria-live="polite">
              {t("finance.i_value")}: <span className="font-semibold text-slate-900">{fmt(cur)(value)}</span>
            </p>
          )}
        </div>
        <SheetFoot onCancel={cancel} onSave={save} busy={busy} testid="inv-save" saveLabel={t("finance.save_item")}
          busyLabel={file ? t("finance.ai_reading") : t("finance.saving")} />
      </DialogContent>
    </Dialog>
  );
}

const INCOME_BLANK = { title: "", customer_name: "", amount: "", number: "", date: "", due_date: "", status: "unpaid", notes: "" };

export function AddIncomeDialog({ open, onOpenChange, onDone }) {
  const { tenant } = useAuth();
  const L = lex(tenant);
  const uid = useId();
  const [f, setF, draft] = useDraft("income", INCOME_BLANK);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  // PILOT-1 A — closing keeps what was typed (see KEEP below); Cancel and Save
  // are what empty the form.
  const close = () => onOpenChange(false);
  const cancel = () => { draft.discard(); setFile(null); onOpenChange(false); };
  const save = async () => {
    if (!f.title.trim() && !f.amount && !f.customer_name.trim() && !file) return toast.error("Add a title, customer or amount");
    setBusy(true);
    try {
      await api.post("/revenue/with-file", formData(f, file));
      toast.success(file ? "Income recorded from the invoice" : "Income recorded");
      cancel();
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not record income");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-xl")} data-testid="income-dialog">
        <SheetHead icon={CurrencyInr} title="Record sale / service income"
          description="Money coming in. Attach a sales invoice and AI reads the amount and customer, or type it in." onClose={close} />
        <div className="space-y-4 px-6 pb-5">
          {draft.restored && <DraftNote onDiscard={() => draft.discard()} label={KEPT_LABEL} testid="income-draft" className="-mt-2" />}
          <FileField file={file} setFile={setFile} />
          <Field label="What was it for" htmlFor={`${uid}-title`}>
            <input id={`${uid}-title`} data-testid="income-title" className={FIELD} value={f.title}
              onChange={(e) => set("title", e.target.value)} placeholder="e.g. Design retainer · Order #204" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" htmlFor={`${uid}-amount`}>
              <input id={`${uid}-amount`} data-testid="income-amount" type="number" inputMode="decimal" className={FIELD} value={f.amount} onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <Field label="Payment status" htmlFor={`${uid}-status`}>
              <GlassSelect id={`${uid}-status`} variant="field" triggerClassName={FIELD} testid="income-status" ariaLabel="Payment status"
                value={f.status} onChange={(v) => set("status", v)}
                options={[{ value: "unpaid", label: "Awaiting payment" }, { value: "paid", label: "Received" }]} />
            </Field>
          </div>
          <Field label={`${L.customer_singular} name`} htmlFor={`${uid}-customer`}>
            <input id={`${uid}-customer`} data-testid="income-customer" className={FIELD} value={f.customer_name} onChange={(e) => set("customer_name", e.target.value)} />
          </Field>
          {/* Phone: a third of the sheet is too narrow for a date field, so the
              invoice number takes a row and the two dates share the next. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Invoice #" htmlFor={`${uid}-number`} className="col-span-2 sm:col-span-1">
              <input id={`${uid}-number`} className={FIELD} value={f.number} onChange={(e) => set("number", e.target.value)} />
            </Field>
            <Field label="Date" htmlFor={`${uid}-date`}>
              <input id={`${uid}-date`} type="date" className={FIELD} value={f.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label="Due date" htmlFor={`${uid}-due`}>
              <input id={`${uid}-due`} type="date" className={FIELD} value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />
            </Field>
          </div>
        </div>
        <SheetFoot onCancel={cancel} onSave={save} busy={busy} testid="income-save" saveLabel="Save income"
          busyLabel={file ? "AI reading…" : "Saving…"} />
      </DialogContent>
    </Dialog>
  );
}

/** All four dialogs, driven by one `adding` value ("expense" | "asset" | …). */
export function AddRecordDialogs({ adding, setAdding, categories, assetCategories, cur, onDone }) {
  const bind = (kind) => ({ open: adding === kind, onOpenChange: (o) => setAdding(o ? kind : null), onDone });
  return (
    <>
      <AddIncomeDialog {...bind("income")} />
      <AddExpenseDialog {...bind("expense")} categories={categories} />
      <AddAssetDialog {...bind("asset")} categories={assetCategories} />
      <AddInventoryDialog {...bind("inventory")} cur={cur} />
    </>
  );
}

const TAB_KIND = { revenue: "income", expenses: "expense", assets: "asset", inventory: "inventory" };

/**
 * The reference's split button. On a records tab the left half adds that
 * tab's record (keeping the add-*-btn hooks) and the caret offers the rest;
 * on Overview and Inbox the whole pill is "Add record".
 */
export function AddRecordControl({ tab, onPick }) {
  const { t } = useTranslation();
  const { tenant } = useAuth();
  const L = lex(tenant);
  const [open, setOpen] = useState(false);
  const kinds = {
    income: { icon: CurrencyInr, title: "Income", hint: `A sale or service invoice — money in from a ${L.customer_singular.toLowerCase()}`, button: "Add income", testid: "add-income-btn" },
    expense: { icon: Receipt, title: "Expense", hint: `A bill or payment — money out to a ${L.vendor_singular.toLowerCase()}`, button: t("finance.add_expense"), testid: "add-expense-btn" },
    asset: { icon: Buildings, title: "Asset", hint: "Machinery, equipment or property you own", button: t("finance.add_asset"), testid: "add-asset-btn" },
    inventory: { icon: Package, title: "Inventory item", hint: "Stock on hand; value is quantity × unit cost", button: t("finance.add_item"), testid: "add-inventory-btn" },
  };
  const primary = TAB_KIND[tab];
  const pick = (kind) => setTimeout(() => onPick(kind), 0);
  const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50";

  return (
    <div className={`flex h-11 shrink-0 items-stretch overflow-hidden rounded-pill ${INK_PILL}`}>
      {primary && (
        <button type="button" onClick={() => onPick(primary)} data-testid={kinds[primary].testid}
          className={`flex items-center gap-2 pl-4 pr-3.5 text-sm font-medium ${ring}`}>
          <Plus size={16} weight="bold" aria-hidden="true" /> {kinds[primary].button}
        </button>
      )}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" data-testid="add-record-menu" aria-label={primary ? "Add another kind of record" : "Add record"}
            className={primary
              ? `grid w-11 place-items-center border-l border-white/15 ${ring}`
              : `flex items-center gap-2 pl-4 pr-4 text-sm font-medium ${ring}`}>
            {!primary && <><Plus size={16} weight="bold" aria-hidden="true" /> Add record</>}
            <CaretDown size={13} weight="bold" aria-hidden="true"
              className={`opacity-80 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} collisionPadding={12}
          className={`${GLASS_MENU} w-[min(20rem,calc(100vw-1.5rem))] p-1.5`} data-testid="add-record-list">
          {Object.entries(kinds).map(([kind, k]) => (
            <DropdownMenuItem key={kind} data-testid={`add-record-${kind}`} onSelect={() => pick(kind)}
              className={`${GLASS_MENU_ITEM} items-start gap-3 px-3 py-2.5`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-900/[0.05] text-slate-700 ring-1 ring-inset ring-slate-900/[0.04]">
                <k.icon size={18} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{k.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-500">{k.hint}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
