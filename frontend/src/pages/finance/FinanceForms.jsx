// Finance — adding records (2026-09-14). The four dialogs are controlled from
// the page, so one "Add record" menu, a tab's own Add button and the phone's
// Quick capture "Add expense" all open the same dialog (the old phone button
// clicked a selector nothing carried — FN-08). Every choice is our own
// dropdown, never the operating system's list.
import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Buildings, CaretDown, CircleNotch, CurrencyInr, Package, Plus, Receipt, Sparkle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api from "../../lib/api";
import { lex } from "../../lib/lexicon";
import { useAuth } from "../../context/AuthContext";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { GLASS_MENU, GLASS_MENU_ITEM, INK_PILL } from "../../components/neuglass/glass";
import { AREA, FIELD, Field, FileField, SHEET_CONTENT, SheetFoot, SheetHead, fmt } from "./financeKit";
import { DraftNote } from "../../components/neuglass/DraftNote";
import { PartyPicker } from "../../components/neuglass/PartyPicker";
import { useDraft } from "../../hooks/useDraft";
import { InvoiceBuilderDialog } from "./MoneyActions";

const withCurrent = (list, value) => (value && !list.includes(value) ? [value, ...list] : list);

/* PILOT-1 A — KEEP. Every form here held its fields in state and emptied them
   on ANY close — the X, Escape, a click beside it — so an expense half-typed
   when someone stepped away to find the bill was gone. The fields are a draft
   now (lib/drafts.js): closing keeps them for the next time this form opens,
   and Cancel or Save is what empties it. The attached bill is not kept; a
   browser cannot store a file for later. */
const KEPT_LABEL = "Kept from before — not saved yet";

/* PILOT-1 F — "+ NEW CATEGORY", WHERE THE CATEGORY IS CHOSEN.
   The pilot client: "Need to be able to customize and add categories." The
   list was editable only in Settings > Money, behind Manage Team, and nobody
   goes to Settings in the middle of an expense. The last entry of the list now
   opens a name field in place; Add saves it to the company's list (POST
   /ledger/categories — anyone with Finance access) and files this record under
   it. Renaming and removing stay in Settings. */
const NEW_CATEGORY = "__new_category__";

function CategoryField({ kind, value, onChange, categories, withAuto = false, autoLabel, id, testid }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const open = () => { setAdding(true); setName(""); setError(""); setTimeout(() => inputRef.current?.focus(), 0); };
  const add = async () => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) { setError("Give it a name"); inputRef.current?.focus(); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/ledger/categories", { kind, name: clean });
      onChange(data.category);
      toast.success(data.added ? `Added “${data.category}” to your categories` : `“${data.category}” is already a category`);
      qc.invalidateQueries({ queryKey: ["ledger-summary"] });
      setAdding(false);
    } catch (e) {
      setError(e.response?.data?.detail || "Could not add the category");
    } finally {
      setBusy(false);
    }
  };
  if (adding) {
    return (
      <div className="space-y-1.5" data-testid={`${testid}-new`}>
        <div className="flex min-w-0 gap-2">
          <input ref={inputRef} id={id} value={name} maxLength={40} disabled={busy}
            data-testid={`${testid}-new-name`} aria-label="New category name"
            aria-invalid={error ? "true" : undefined}
            onChange={(e) => { setName(e.target.value); if (error) setError(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); add(); }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAdding(false); }
            }}
            placeholder="New category"
            className="nm-field h-11 min-w-0 flex-1 px-4 text-sm text-slate-800 placeholder:text-slate-400" />
          <button type="button" onClick={add} disabled={busy} data-testid={`${testid}-new-add`}
            className={`h-11 shrink-0 rounded-pill px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 disabled:opacity-50 ${INK_PILL}`}>
            {busy ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={() => setAdding(false)} disabled={busy} data-testid={`${testid}-new-cancel`}
            aria-label="Cancel the new category"
            className="h-11 shrink-0 rounded-pill px-3 text-sm font-medium text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40">
            Cancel
          </button>
        </div>
        {error && <p role="alert" className="text-xs font-medium text-ng-accent">{error}</p>}
      </div>
    );
  }
  return (
    <GlassSelect id={id} variant="field" triggerClassName={FIELD} testid={testid} ariaLabel="Category"
      value={value} onChange={(v) => (v === NEW_CATEGORY ? open() : onChange(v))}
      options={[
        ...(withAuto ? [{ value: "", label: autoLabel }] : []),
        ...withCurrent(categories, value).map((c) => ({ value: c, label: c })),
        { value: NEW_CATEGORY, label: "+ New category" },
      ]} />
  );
}

const formData = (fields, file) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v ?? ""));
  if (file) fd.append("file", file);
  return fd;
};

/* 2026-10-30 (founder) — THE AI FILLS THE FORM; THE PERSON CONFIRMS. A bill
   attached here used to go to the AI on Save and be filed with whatever it
   read: a wrong amount or customer reached the books unchecked. Now choosing
   the file sends it to POST /ledger/read-bill, which stores and reads it and
   saves nothing. What the AI found fills the fields that are still empty, each
   marked "AI" until it is changed; the person checks, corrects and saves, and
   the stored bill is attached as it is (attachment_path), not read again. */
function useBillReader(kind, f, setF, blank) {
  const [file, setFileState] = useState(null);
  const [bill, setBill] = useState(null);   // {reading} | {attachment, filled, read, note} | {failed, note}
  const seq = useRef(0);
  const isBlank = (k, v) => v == null || v === "" || v === blank[k];
  const setFile = async (sel) => {
    const n = ++seq.current;
    setFileState(sel);
    if (!sel) { setBill(null); return; }
    setBill({ reading: true });
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("file", sel);
      const { data } = await api.post("/ledger/read-bill", fd);
      if (n !== seq.current) return;                 // another file was chosen meanwhile
      const found = data.fields || {};
      const filled = Object.keys(found).filter((k) => k in blank && isBlank(k, f[k]));
      setF((cur) => ({ ...cur, ...Object.fromEntries(filled.filter((k) => isBlank(k, cur[k])).map((k) => [k, String(found[k])])) }));
      setBill({ attachment: data.attachment, filled, read: data.read, note: data.read_note });
    } catch (e) {
      if (n !== seq.current) return;
      setBill({ failed: true, note: e.response?.data?.detail });
    }
  };
  return {
    file, setFile, bill,
    reading: !!bill?.reading,
    ai: (k) => !!bill?.filled?.includes(k),
    edited: (k) => setBill((b) => (b?.filled?.includes(k) ? { ...b, filled: b.filled.filter((x) => x !== k) } : b)),
    // What Save sends: the checked fields and the stored bill; a bill that
    // couldn't be stored for reading goes with the save, not read.
    payload: (fields) => {
      const fd = formData(fields, null);
      if (bill?.attachment?.storage_path) {
        fd.append("attachment_path", bill.attachment.storage_path);
        fd.append("attachment_name", bill.attachment.filename || file?.name || "");
      } else if (file) {
        fd.append("file", file);
        fd.append("ai_read", "false");
      }
      return fd;
    },
    reset: () => { seq.current += 1; setFileState(null); setBill(null); },
  };
}

/** What the AI did with the bill, above the fields. */
function BillNote({ bill, testid }) {
  if (!bill) return null;
  const base = "flex items-start gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] leading-snug ring-1 ring-inset";
  if (bill.reading) {
    return (
      <p className={cn(base, "bg-slate-500/[0.06] text-slate-700 ring-slate-900/[0.05]")} data-testid={testid} aria-live="polite">
        <CircleNotch size={15} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" /> AI is reading the bill…
      </p>
    );
  }
  if (bill.failed || bill.note || !bill.filled?.length) {
    const text = bill.note
      || (bill.failed ? "Couldn't read the bill. Fill in the details yourself; it stays attached."
        : "AI read the bill but found nothing to fill in. Fill in the details yourself.");
    return <p className={cn(base, "bg-amber-50/90 text-amber-900 ring-amber-100")} data-testid={testid} aria-live="polite">{text}</p>;
  }
  return (
    <p className={cn(base, "bg-sky-50/90 text-sky-900 ring-sky-100")} data-testid={testid} aria-live="polite">
      <Sparkle size={15} weight="fill" className="mt-0.5 shrink-0 text-orange-500" aria-hidden="true" />
      <span>AI filled {bill.filled.length} field{bill.filled.length === 1 ? "" : "s"} from the bill. Check the highlighted ones, then save.</span>
    </p>
  );
}

/** A field label with an "AI" tag while the AI's value is still in it. */
const aiLabel = (text, on) => (on
  ? <span className="inline-flex items-center gap-1.5">{text}<span className="rounded-md bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800" data-ai-filled="">AI</span></span>
  : text);
const AI_FIELD = "ring-2 ring-amber-300/80 bg-amber-50/70";

const EXPENSE_BLANK = { title: "", amount: "", vendor_name: "", vendor_id: "", category: "", date: "", status: "unpaid", notes: "" };

export function AddExpenseDialog({ open, onOpenChange, categories = [], onDone }) {
  const { t } = useTranslation();
  const { tenant } = useAuth();
  const L = lex(tenant);
  const uid = useId();
  const [f, setF, draft] = useDraft("expense", EXPENSE_BLANK);
  const reader = useBillReader("expense", f, setF, EXPENSE_BLANK);
  const { file, setFile } = reader;
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); reader.edited(k); };
  // PILOT-1 A — closing keeps what was typed (see KEEP below); Cancel and Save
  // are what empty the form.
  const close = () => onOpenChange(false);
  const cancel = () => { draft.discard(); reader.reset(); onOpenChange(false); };

  const suggest = async () => {
    const text = `${f.title} ${f.vendor_name} ${f.notes}`.trim();
    if (!text) return toast.error(t("finance.add_title_first"));
    setSuggesting(true);
    try {
      const { data } = await api.post("/expenses/suggest-category", { text });
      set("category", data.category);
      // 2026-10-06 — calculated from the company's own bills; say what decided it.
      toast.success(t("finance.ai_suggests", { category: data.category }), data.reason ? { description: data.reason } : undefined);
    } catch {
      toast.error(t("finance.could_not_create"));
    } finally {
      setSuggesting(false);
    }
  };
  const save = async () => {
    if (reader.reading) return toast.message("AI is still reading the bill — a moment.");
    if (!f.title.trim() && !f.amount && !file) return toast.error(t("finance.need_expense"));
    setBusy(true);
    try {
      await api.post("/expenses/with-file", reader.payload(f));
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
          <BillNote bill={reader.bill} testid="expense-bill-note" />
          <Field label={aiLabel(t("finance.c_title"), reader.ai("title"))} htmlFor={`${uid}-title`}>
            <input id={`${uid}-title`} data-testid="expense-title" className={cn(FIELD, reader.ai("title") && AI_FIELD)} value={f.title}
              onChange={(e) => set("title", e.target.value)} placeholder={t("finance.exp_title_ph")} />
          </Field>
          {/* Five rows, not seven: the dialog fits a 900px-tall laptop without
              scrolling, and folds to two columns on a phone. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={aiLabel(t("finance.c_amount"), reader.ai("amount"))} htmlFor={`${uid}-amount`}>
              <input id={`${uid}-amount`} data-testid="expense-amount" type="number" inputMode="decimal" className={cn(FIELD, reader.ai("amount") && AI_FIELD)}
                value={f.amount} onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <Field label={t("finance.f_status")} htmlFor={`${uid}-status`}>
              <GlassSelect id={`${uid}-status`} variant="field" triggerClassName={FIELD} testid="expense-status" ariaLabel={t("finance.f_status")}
                value={f.status} onChange={(v) => set("status", v)}
                options={[{ value: "unpaid", label: t("finance.unpaid") }, { value: "paid", label: t("finance.paid") }]} />
            </Field>
            <Field label={aiLabel(t("finance.c_date"), reader.ai("date"))} htmlFor={`${uid}-date`} className="col-span-2 sm:col-span-1">
              <input id={`${uid}-date`} type="date" className={cn(FIELD, reader.ai("date") && AI_FIELD)} value={f.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={aiLabel(t("finance.f_vendor", { vendor: L.vendor_singular }), reader.ai("vendor_name"))} htmlFor={`${uid}-vendor`}>
              <PartyPicker kind="vendor" noun={L.vendor_singular} id={`${uid}-vendor`} testid="expense-vendor"
                name={f.vendor_name} linkedId={f.vendor_id}
                onChange={({ name, id }) => { setF((s) => ({ ...s, vendor_name: name, vendor_id: id })); reader.edited("vendor_name"); }} />
            </Field>
            <Field label={aiLabel(t("finance.c_category"), reader.ai("category"))} htmlFor={`${uid}-category`}
              aside={(
                <button type="button" onClick={suggest} disabled={suggesting} data-testid="expense-suggest-category"
                  className="flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-white/80 disabled:opacity-50">
                  <Sparkle size={13} weight="fill" aria-hidden="true" className="text-orange-500" />
                  {suggesting ? t("finance.thinking") : t("finance.ai_suggest")}
                </button>
              )}>
              <CategoryField kind="expense" id={`${uid}-category`} testid="expense-category"
                value={f.category} onChange={(v) => set("category", v)} categories={categories}
                withAuto autoLabel={t("finance.auto")} />
            </Field>
          </div>
          <Field label={t("finance.f_notes")} htmlFor={`${uid}-notes`}>
            <textarea id={`${uid}-notes`} className={AREA} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        <SheetFoot onCancel={cancel} onSave={save} busy={busy || reader.reading} testid="expense-save" saveLabel={t("finance.save_expense")}
          busyLabel={reader.reading ? t("finance.ai_reading") : t("finance.saving")} />
      </DialogContent>
    </Dialog>
  );
}

const ASSET_BLANK = { name: "", purchase_amount: "", category: "Equipment", vendor_name: "", vendor_id: "", purchase_date: "", status: "active", notes: "" };

export function AddAssetDialog({ open, onOpenChange, categories = [], onDone }) {
  const { t } = useTranslation();
  const { tenant } = useAuth();
  const L = lex(tenant);
  const uid = useId();
  const [f, setF, draft] = useDraft("asset", ASSET_BLANK);
  const reader = useBillReader("asset", f, setF, ASSET_BLANK);
  const { file, setFile } = reader;
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); reader.edited(k); };
  // PILOT-1 A — closing keeps what was typed (see KEEP below); Cancel and Save
  // are what empty the form.
  const close = () => onOpenChange(false);
  const cancel = () => { draft.discard(); reader.reset(); onOpenChange(false); };
  const save = async () => {
    if (reader.reading) return toast.message("AI is still reading the bill — a moment.");
    if (!f.name.trim() && !file) return toast.error(t("finance.need_asset"));
    setBusy(true);
    try {
      await api.post("/assets/with-file", reader.payload(f));
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
          <BillNote bill={reader.bill} testid="asset-bill-note" />
          <Field label={aiLabel(t("finance.asset_name"), reader.ai("name"))} htmlFor={`${uid}-name`}>
            <input id={`${uid}-name`} data-testid="asset-name" className={cn(FIELD, reader.ai("name") && AI_FIELD)} value={f.name}
              onChange={(e) => set("name", e.target.value)} placeholder={t("finance.asset_name_ph")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={aiLabel(t("finance.purchase_amount"), reader.ai("purchase_amount"))} htmlFor={`${uid}-amount`}>
              <input id={`${uid}-amount`} data-testid="asset-amount" type="number" inputMode="decimal" className={cn(FIELD, reader.ai("purchase_amount") && AI_FIELD)}
                value={f.purchase_amount} onChange={(e) => set("purchase_amount", e.target.value)} />
            </Field>
            <Field label={aiLabel(t("finance.c_category"), reader.ai("category"))} htmlFor={`${uid}-category`}>
              <CategoryField kind="asset" id={`${uid}-category`} testid="asset-category"
                value={f.category} onChange={(v) => set("category", v)} categories={categories} />
            </Field>
          </div>
          <Field label={aiLabel(L.vendor_singular, reader.ai("vendor_name"))} htmlFor={`${uid}-vendor`}>
            <PartyPicker kind="vendor" noun={L.vendor_singular} id={`${uid}-vendor`} testid="asset-vendor"
              name={f.vendor_name} linkedId={f.vendor_id}
              onChange={({ name, id }) => { setF((s) => ({ ...s, vendor_name: name, vendor_id: id })); reader.edited("vendor_name"); }} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={aiLabel(t("finance.purchase_date"), reader.ai("purchase_date"))} htmlFor={`${uid}-date`}>
              <input id={`${uid}-date`} type="date" className={cn(FIELD, reader.ai("purchase_date") && AI_FIELD)} value={f.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} />
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
        <SheetFoot onCancel={cancel} onSave={save} busy={busy || reader.reading} testid="asset-save" saveLabel={t("finance.save_asset")}
          busyLabel={reader.reading ? t("finance.ai_reading") : t("finance.saving")} />
      </DialogContent>
    </Dialog>
  );
}

const INVENTORY_BLANK = { item: "", sku: "", quantity: "", unit: "unit", unit_cost: "", category: "", vendor_name: "", vendor_id: "", notes: "" };

export function AddInventoryDialog({ open, onOpenChange, cur, onDone }) {
  const { t } = useTranslation();
  const { tenant } = useAuth();
  const L = lex(tenant);
  const uid = useId();
  const [f, setF, draft] = useDraft("inventory", INVENTORY_BLANK);
  const reader = useBillReader("inventory", f, setF, INVENTORY_BLANK);
  const { file, setFile } = reader;
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); reader.edited(k); };
  // PILOT-1 A — closing keeps what was typed (see KEEP below); Cancel and Save
  // are what empty the form.
  const close = () => onOpenChange(false);
  const cancel = () => { draft.discard(); reader.reset(); onOpenChange(false); };
  const value = (Number(f.quantity) || 0) * (Number(f.unit_cost) || 0);
  const save = async () => {
    if (reader.reading) return toast.message("AI is still reading the bill — a moment.");
    if (!f.item.trim() && !file) return toast.error(t("finance.need_item"));
    setBusy(true);
    try {
      await api.post("/inventory/with-file", reader.payload(f));
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
          <BillNote bill={reader.bill} testid="inventory-bill-note" />
          <div className="grid grid-cols-2 gap-3">
            <Field label={aiLabel(t("finance.i_item"), reader.ai("item"))} htmlFor={`${uid}-item`}>
              <input id={`${uid}-item`} data-testid="inv-item" className={cn(FIELD, reader.ai("item") && AI_FIELD)} value={f.item} onChange={(e) => set("item", e.target.value)} />
            </Field>
            <Field label={t("finance.i_sku")} htmlFor={`${uid}-sku`}>
              <input id={`${uid}-sku`} className={FIELD} value={f.sku} onChange={(e) => set("sku", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={aiLabel(t("finance.quantity"), reader.ai("quantity"))} htmlFor={`${uid}-qty`}>
              <input id={`${uid}-qty`} data-testid="inv-qty" type="number" inputMode="decimal" className={cn(FIELD, reader.ai("quantity") && AI_FIELD)} value={f.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </Field>
            <Field label={t("finance.unit")} htmlFor={`${uid}-unit`}>
              <input id={`${uid}-unit`} className={FIELD} value={f.unit} onChange={(e) => set("unit", e.target.value)} />
            </Field>
            <Field label={aiLabel(t("finance.unit_cost"), reader.ai("unit_cost"))} htmlFor={`${uid}-cost`}>
              <input id={`${uid}-cost`} data-testid="inv-cost" type="number" inputMode="decimal" className={cn(FIELD, reader.ai("unit_cost") && AI_FIELD)} value={f.unit_cost} onChange={(e) => set("unit_cost", e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("finance.c_category")} htmlFor={`${uid}-category`}>
              <input id={`${uid}-category`} className={FIELD} value={f.category} onChange={(e) => set("category", e.target.value)} />
            </Field>
            <Field label={aiLabel(L.vendor_singular, reader.ai("vendor_name"))} htmlFor={`${uid}-vendor`}>
              <PartyPicker kind="vendor" noun={L.vendor_singular} id={`${uid}-vendor`} testid="inv-vendor"
                name={f.vendor_name} linkedId={f.vendor_id}
                onChange={({ name, id }) => { setF((s) => ({ ...s, vendor_name: name, vendor_id: id })); reader.edited("vendor_name"); }} />
            </Field>
          </div>
          {value > 0 && (
            <p className="text-sm text-slate-600" aria-live="polite">
              {t("finance.i_value")}: <span className="font-semibold text-slate-900">{fmt(cur)(value)}</span>
            </p>
          )}
        </div>
        <SheetFoot onCancel={cancel} onSave={save} busy={busy || reader.reading} testid="inv-save" saveLabel={t("finance.save_item")}
          busyLabel={reader.reading ? t("finance.ai_reading") : t("finance.saving")} />
      </DialogContent>
    </Dialog>
  );
}

const INCOME_BLANK = { title: "", customer_name: "", contact_id: "", amount: "", number: "", date: "", due_date: "", status: "unpaid", notes: "" };

export function AddIncomeDialog({ open, onOpenChange, onDone }) {
  const { tenant } = useAuth();
  const L = lex(tenant);
  const uid = useId();
  const [f, setF, draft] = useDraft("income", INCOME_BLANK);
  const reader = useBillReader("income", f, setF, INCOME_BLANK);
  const { file, setFile } = reader;
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); reader.edited(k); };
  // PILOT-1 A — closing keeps what was typed (see KEEP below); Cancel and Save
  // are what empty the form.
  const close = () => onOpenChange(false);
  const cancel = () => { draft.discard(); reader.reset(); onOpenChange(false); };
  const save = async () => {
    if (reader.reading) return toast.message("AI is still reading the invoice — a moment.");
    if (!f.title.trim() && !f.amount && !f.customer_name.trim() && !file) return toast.error("Add a title, customer or amount");
    setBusy(true);
    try {
      await api.post("/revenue/with-file", reader.payload(f));
      toast.success(file ? "Income recorded with the invoice attached" : "Income recorded");
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
          <BillNote bill={reader.bill} testid="income-bill-note" />
          <Field label={aiLabel("What was it for", reader.ai("title"))} htmlFor={`${uid}-title`}>
            <input id={`${uid}-title`} data-testid="income-title" className={cn(FIELD, reader.ai("title") && AI_FIELD)} value={f.title}
              onChange={(e) => set("title", e.target.value)} placeholder="e.g. Design retainer · Order #204" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={aiLabel("Amount", reader.ai("amount"))} htmlFor={`${uid}-amount`}>
              <input id={`${uid}-amount`} data-testid="income-amount" type="number" inputMode="decimal" className={cn(FIELD, reader.ai("amount") && AI_FIELD)} value={f.amount} onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <Field label="Payment status" htmlFor={`${uid}-status`}>
              <GlassSelect id={`${uid}-status`} variant="field" triggerClassName={FIELD} testid="income-status" ariaLabel="Payment status"
                value={f.status} onChange={(v) => set("status", v)}
                options={[{ value: "unpaid", label: "Awaiting payment" }, { value: "paid", label: "Received" }]} />
            </Field>
          </div>
          <Field label={aiLabel(`${L.customer_singular} name`, reader.ai("customer_name"))} htmlFor={`${uid}-customer`}>
            <PartyPicker kind="customer" noun={L.customer_singular} id={`${uid}-customer`} testid="income-customer"
              name={f.customer_name} linkedId={f.contact_id}
              onChange={({ name, id }) => { setF((s) => ({ ...s, customer_name: name, contact_id: id })); reader.edited("customer_name"); }} />
          </Field>
          {/* Phone: a third of the sheet is too narrow for a date field, so the
              invoice number takes a row and the two dates share the next. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={aiLabel("Invoice #", reader.ai("number"))} htmlFor={`${uid}-number`} className="col-span-2 sm:col-span-1">
              <input id={`${uid}-number`} data-testid="income-number" className={cn(FIELD, reader.ai("number") && AI_FIELD)} value={f.number} onChange={(e) => set("number", e.target.value)} />
            </Field>
            <Field label={aiLabel("Date", reader.ai("date"))} htmlFor={`${uid}-date`}>
              <input id={`${uid}-date`} type="date" className={cn(FIELD, reader.ai("date") && AI_FIELD)} value={f.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
            <Field label={aiLabel("Due date", reader.ai("due_date"))} htmlFor={`${uid}-due`}>
              <input id={`${uid}-due`} type="date" className={cn(FIELD, reader.ai("due_date") && AI_FIELD)} value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />
            </Field>
          </div>
        </div>
        <SheetFoot onCancel={cancel} onSave={save} busy={busy || reader.reading} testid="income-save" saveLabel="Save income"
          busyLabel={reader.reading ? "AI reading…" : "Saving…"} />
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
      {/* Audit F-03 — a GST / export invoice with line items, and its PDF. */}
      <InvoiceBuilderDialog {...bind("invoice")} />
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
    invoice: { icon: Receipt, title: "Invoice", hint: `A GST or export invoice with line items, to send to a ${L.customer_singular.toLowerCase()} as a PDF`, button: "New invoice", testid: "add-invoice-btn" },
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
