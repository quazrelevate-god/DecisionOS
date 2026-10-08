// Finance — closing the money loop (product audit 2026-10-08).
//
//   F-02  RecordPaymentDialog — money received on an invoice, or paid on a
//         supplier bill, in full or in part. Before this the only ways a
//         payment reached the books were WhatsApp and an uploaded receipt, so
//         an owner who got a bank transfer could not say so.
//         BillsToPayPanel — the supplier bills still unpaid, with Pay. Purchase
//         bills had no list anywhere: a bill read from a photo was invisible
//         until somebody opened the matching picker.
//   F-03  InvoiceBuilderDialog — a GST invoice with line items, HSN/SAC and
//         CGST+SGST or IGST worked out from the place of supply, or an export
//         invoice in the buyer's currency with no GST; and downloadInvoicePdf.
//   F-04  UseStockDialog — stock taken out for an order. Profit counts stock
//         when it is USED (the cost of what was sold), never when it is bought.
//   FX    SetRateDialog / NeedsRateNote — a GBP 160 export invoice was added to
//         Revenue as Rs 160. A foreign invoice carries its exchange rate; one
//         without a rate is left out of the totals and the page asks for it.
import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowsLeftRight, FilePdf, HandCoins, Package, Plus, Receipt, Trash, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { lex } from "../../lib/lexicon";
import { shortDate } from "../../lib/format";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { GlassSelect } from "../../components/karma/GlassSelect";
import { PartyPicker } from "../../components/karma/PartyPicker";
import { AREA, CARD, FIELD, Field, SHEET_CONTENT, SMALL_INK, SMALL_PILL, SheetFoot, SheetHead, Tag, fmt } from "./financeKit";

const today = () => new Date().toISOString().slice(0, 10);
const errText = (e, fallback) => formatApiError(e.response?.data?.detail) || fallback;
const METHODS = [
  { value: "bank transfer", label: "Bank transfer" }, { value: "upi", label: "UPI" },
  { value: "cash", label: "Cash" }, { value: "cheque", label: "Cheque" },
  { value: "card", label: "Card" }, { value: "other", label: "Other" },
];

const balanceOf = (inv) => Math.max(0, (Number(inv?.amount) || 0) - (Number(inv?.amount_paid) || 0));

/* ---------------------------------------------------------------- F-02 ---- */
export function RecordPaymentDialog({ invoice, onOpenChange, onDone }) {
  const uid = useId();
  const open = !!invoice;
  const incoming = invoice?.type !== "purchase_bill";
  const due = invoice ? (invoice.balance ?? balanceOf(invoice)) : 0;
  const f = useMemo(() => fmt(invoice?.currency || "INR"), [invoice]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState("bank transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!invoice) return;
    setAmount(String(Math.round(due * 100) / 100)); setDate(today()); setMethod("bank transfer"); setReference("");
  }, [invoice]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const n = Number(amount);
    if (!(n > 0)) return toast.error("Enter the amount that was paid");
    if (n > due + 0.01) return toast.error(`That is more than the ${f(due)} still due`);
    setBusy(true);
    try {
      const { data } = await api.post(`/invoices/${invoice.id}/payments`, { amount: n, date, method, reference });
      const left = data.invoice?.balance || 0;
      toast.success(left > 0.01 ? `Recorded ${f(n)} — ${f(left)} still due` : `Recorded — ${incoming ? "invoice" : "bill"} fully paid`);
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(errText(e, "Couldn't record the payment"));
    } finally {
      setBusy(false);
    }
  };
  const who = invoice?.contact_name || (incoming ? "the buyer" : "the supplier");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-md")} data-testid="record-payment-dialog">
        <SheetHead icon={HandCoins} title={incoming ? "Record payment received" : "Record payment made"}
          description={invoice ? `${invoice.number ? `#${invoice.number} · ` : ""}${who} · ${f(due)} still due` : ""}
          onClose={() => onOpenChange(false)} />
        <div className="space-y-4 px-6 pb-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" htmlFor={`${uid}-amt`}>
              <input id={`${uid}-amt`} data-testid="payment-amount" type="number" inputMode="decimal" className={FIELD}
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Date" htmlFor={`${uid}-date`}>
              <input id={`${uid}-date`} type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {Number(amount) > 0 && Number(amount) < due - 0.01 && (
            <p className="-mt-2 text-xs text-slate-500" data-testid="payment-part-note">
              A part payment — {f(due - Number(amount))} will still be due.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="How" htmlFor={`${uid}-method`}>
              <GlassSelect id={`${uid}-method`} variant="field" triggerClassName={FIELD} testid="payment-method"
                ariaLabel="Payment method" value={method} onChange={setMethod} options={METHODS} />
            </Field>
            <Field label="Reference (UTR / cheque no.)" htmlFor={`${uid}-ref`}>
              <input id={`${uid}-ref`} className={FIELD} value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>
        </div>
        <SheetFoot onCancel={() => onOpenChange(false)} onSave={save} busy={busy} testid="payment-save"
          saveLabel="Record payment" busyLabel="Recording…" />
      </DialogContent>
    </Dialog>
  );
}

export function BillsToPayPanel({ bills, total, cur, onPay }) {
  const f = fmt(cur);
  if (!bills || bills.length === 0) return null;
  return (
    <section className={`p-5 ${CARD}`} data-testid="bills-to-pay">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">
          Bills to pay <span className="font-normal text-slate-500">({bills.length})</span>
        </h2>
        <span className="text-sm font-semibold tabular-nums text-slate-900" data-testid="bills-to-pay-total">{f(total)}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">Supplier bills not paid yet. Record a payment when the money goes out — in full or in part.</p>
      <ul className="mt-4 space-y-2">
        {bills.map((b) => (
          <li key={b.id} data-testid={`bill-${b.id}`}
            className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-white/70 p-3 ring-1 ring-inset ring-slate-900/[0.05]">
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {fmt(b.currency || cur)(b.balance)}
              {b.currency && b.currency !== cur && b.balance_base != null && (
                <span className="ml-1 text-xs font-normal text-slate-500">≈ {f(b.balance_base)}</span>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              {b.contact_name || b.title || "Supplier"}{b.number ? ` · #${b.number}` : ""}
              {b.due_date ? ` · due ${shortDate(b.due_date)}` : b.date ? ` · ${shortDate(b.date)}` : ""}
            </span>
            {b.balance < b.amount - 0.01 && <Tag tone="warn">part paid</Tag>}
            <button type="button" className={SMALL_INK} data-testid={`bill-pay-${b.id}`}
              onClick={() => onPay({ ...b, type: "purchase_bill", currency: b.currency || cur })}>Record payment</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- F-03 ---- */
export async function downloadInvoicePdf(inv) {
  try {
    const res = await api.get(`/invoices/${inv.id}/pdf`, { responseType: "blob" });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${String(inv.number || "invoice").replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    toast.error("Couldn't make the PDF. Try again in a moment.");
  }
}

export function InvoiceRowActions({ inv, onPay, onSetRate }) {
  const due = inv.balance ?? balanceOf(inv);
  const needsRate = "amount_base" in inv && inv.amount_base == null;
  return (
    <span className="inline-flex items-center gap-1">
      {needsRate && onSetRate && (
        <button type="button" className={SMALL_PILL} data-testid={`revenue-rate-${inv.id}`}
          onClick={() => onSetRate(inv)}>Set rate</button>
      )}
      {inv.status !== "paid" && due > 0.01 && inv.status !== "draft" && (
        <button type="button" className={SMALL_PILL} data-testid={`revenue-pay-${inv.id}`}
          onClick={() => onPay({ ...inv, type: "sales_invoice" })}>Record payment</button>
      )}
      <button type="button" onClick={() => downloadInvoicePdf(inv)} data-testid={`revenue-pdf-${inv.id}`}
        aria-label={`Download invoice ${inv.number || ""} as PDF`} title="Download PDF"
        className="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition-colors hover:bg-white hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25">
        <FilePdf size={16} aria-hidden="true" />
      </button>
    </span>
  );
}

const BLANK_LINE = { description: "", hsn: "", qty: "1", unit: "pcs", rate: "", gst_rate: "5" };
// A new line takes the company's default GST rate when it has set one (audit B-12).
const blankLine = (meta) => ({ ...BLANK_LINE,
  ...(meta?.default_gst_rate != null ? { gst_rate: String(meta.default_gst_rate) } : {}) });
const CURRENCIES = ["INR", "USD", "GBP", "EUR", "AED", "SGD"];

function calc(lines, sellerState, place, currency) {
  const exportSale = place === "Export (outside India)" || currency !== "INR";
  const intra = !exportSale && (!place || !sellerState || place === sellerState);
  let taxable = 0;
  let tax = 0;
  for (const l of lines) {
    const v = (Number(l.qty) || 0) * (Number(l.rate) || 0);
    taxable += v;
    if (!exportSale) tax += (v * (Number(l.gst_rate) || 0)) / 100;
  }
  const gross = taxable + tax;
  const total = currency === "INR" ? Math.round(gross) : Math.round(gross * 100) / 100;
  return { exportSale, intra, taxable, tax, total };
}

export function InvoiceBuilderDialog({ open, onOpenChange, onDone }) {
  const { tenant } = useAuth();
  const L = lex(tenant);
  const uid = useId();
  const metaQ = useQuery({ queryKey: ["invoice-next-number"], queryFn: () => api.get("/invoices/next-number").then((r) => r.data), enabled: open });
  const contactsQ = useQuery({ queryKey: ["contacts-for-invoice"], queryFn: () => api.get("/contacts").then((r) => r.data), enabled: open, staleTime: 60000 });
  const meta = metaQ.data;
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !meta || f) return;
    /* Audit B-12 (2026-10-08) — the company's own defaults (Settings › Company
       details › On your invoices): its usual GST rate on every new line, and a
       due date from its payment terms. Both stay editable here. */
    const terms = Number.isInteger(meta.payment_terms_days) ? meta.payment_terms_days : null;
    const due = terms == null ? "" : new Date(Date.now() + terms * 86400000).toISOString().slice(0, 10);
    setF({
      customer_name: "", contact_id: "", customer_gstin: "", customer_address: "",
      place_of_supply: meta.seller_state || "", currency: meta.currency || "INR",
      number: meta.number, date: today(), due_date: due, notes: "", items: [{ ...blankLine(meta) }],
      fx_rate: "",
    });
  }, [open, meta, f]);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setLine = (i, k, v) => setF((s) => ({ ...s, items: s.items.map((l, x) => (x === i ? { ...l, [k]: v } : l)) }));
  const close = () => { onOpenChange(false); setF(null); };

  const pickBuyer = ({ name, id }) => {
    const list = Array.isArray(contactsQ.data) ? contactsQ.data : contactsQ.data?.contacts || [];
    const c = id ? list.find((x) => x.id === id) : null;
    setF((s) => ({ ...s, customer_name: name, contact_id: id || "",
      customer_gstin: c?.tax_id || s.customer_gstin, customer_address: c?.address || s.customer_address }));
  };

  if (!open) return null;
  const sums = f ? calc(f.items, meta?.seller_state, f.place_of_supply, f.currency) : null;
  const money = fmt(f?.currency || "INR");
  // Audit 2026-10-08: an invoice in another currency carries its exchange rate.
  const home = (tenant?.currency || "INR").toUpperCase();
  const foreign = !!f && f.currency !== home;
  const rate = foreign ? (Number(f.fx_rate) || Number(meta?.fx_last?.[f.currency]) || 0) : 1;

  const save = async () => {
    if (!f.customer_name.trim()) return toast.error(`Add the ${L.customer_singular.toLowerCase()}'s name`);
    const items = f.items.filter((l) => l.description.trim() && Number(l.qty) > 0);
    if (!items.length) return toast.error("Add at least one line: what you sold, how many and the rate");
    if (foreign && !(rate > 0)) return toast.error(`Add the exchange rate: 1 ${f.currency} = how many ${home}?`);
    setBusy(true);
    try {
      const { data } = await api.post("/invoices/gst", {
        ...f, contact_id: f.contact_id || null, due_date: f.due_date || null,
        fx_rate: foreign ? rate : null,
        items: items.map((l) => ({ ...l, qty: Number(l.qty), rate: Number(l.rate) || 0, gst_rate: Number(l.gst_rate) || 0 })),
      });
      toast.success(`Invoice ${data.number} raised — ${money(data.amount)}`, {
        action: { label: "Download PDF", onClick: () => downloadInvoicePdf(data) },
      });
      close();
      onDone?.();
    } catch (e) {
      toast.error(errText(e, "Couldn't raise the invoice"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-3xl")} data-testid="invoice-builder">
        <SheetHead icon={Receipt} title="New invoice"
          description="A GST invoice with line items — or an export invoice in your buyer's currency. Download it as a PDF to send."
          onClose={close} />
        {!f ? <div className="ds-skeleton mx-6 mb-6 h-64 rounded-2xl" aria-hidden="true" /> : (
          <div className="space-y-4 px-6 pb-5">
            {meta && !meta.seller_ready && (
              <p className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200" data-testid="invoice-seller-missing">
                Your GSTIN, address or state isn't filled in yet, so the invoice header will be incomplete — add them in
                Settings › Business › Company details.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`${L.customer_singular}`} htmlFor={`${uid}-buyer`}>
                <PartyPicker kind="customer" noun={L.customer_singular} id={`${uid}-buyer`} testid="invoice-buyer"
                  name={f.customer_name} linkedId={f.contact_id} onChange={pickBuyer} />
              </Field>
              <Field label="Their GSTIN (optional)" htmlFor={`${uid}-gstin`}>
                <input id={`${uid}-gstin`} data-testid="invoice-gstin" className={FIELD} value={f.customer_gstin}
                  onChange={(e) => set("customer_gstin", e.target.value.toUpperCase())} placeholder="33ABCDE1234F1Z5" />
              </Field>
            </div>
            <Field label="Billing address" htmlFor={`${uid}-addr`}>
              <textarea id={`${uid}-addr`} rows={2} className={AREA} value={f.customer_address} onChange={(e) => set("customer_address", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Place of supply" htmlFor={`${uid}-pos`} className="col-span-2">
                <GlassSelect id={`${uid}-pos`} variant="field" triggerClassName={FIELD} testid="invoice-place" ariaLabel="Place of supply"
                  value={f.place_of_supply} onChange={(v) => setF((s) => ({ ...s, place_of_supply: v, currency: v.startsWith("Export") ? (s.currency === "INR" ? "USD" : s.currency) : "INR" }))}
                  options={(meta?.states || []).map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="Currency" htmlFor={`${uid}-cur`}>
                <GlassSelect id={`${uid}-cur`} variant="field" triggerClassName={FIELD} testid="invoice-currency" ariaLabel="Currency"
                  value={f.currency} onChange={(v) => set("currency", v)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
              </Field>
              <Field label="Invoice #" htmlFor={`${uid}-no`}>
                <input id={`${uid}-no`} data-testid="invoice-number" className={FIELD} value={f.number} onChange={(e) => set("number", e.target.value)} />
              </Field>
            </div>
            {foreign && (
              <Field label={`Exchange rate — 1 ${f.currency} = how many ${home}`} htmlFor={`${uid}-fx`}>
                <input id={`${uid}-fx`} data-testid="invoice-fx-rate" type="number" inputMode="decimal" className={FIELD}
                  value={f.fx_rate || (meta?.fx_last?.[f.currency] ?? "")} placeholder="e.g. 107.50"
                  onChange={(e) => set("fx_rate", e.target.value)} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" htmlFor={`${uid}-date`}>
                <input id={`${uid}-date`} type="date" className={FIELD} value={f.date} onChange={(e) => set("date", e.target.value)} />
              </Field>
              <Field label="Due date" htmlFor={`${uid}-due`}>
                <input id={`${uid}-due`} type="date" className={FIELD} value={f.due_date} onChange={(e) => set("due_date", e.target.value)} />
              </Field>
            </div>

            <div className="space-y-2" data-testid="invoice-lines">
              <div className="hidden grid-cols-[minmax(0,3fr)_5rem_4rem_4rem_6rem_5rem_2rem] gap-2 px-1 text-[11px] font-medium uppercase tracking-wider text-slate-500 sm:grid">
                <span>Description</span><span>HSN/SAC</span><span>Qty</span><span>Unit</span><span>Rate</span><span>GST %</span><span />
              </div>
              {f.items.map((l, i) => (
                <div key={i} className="grid grid-cols-6 gap-2 sm:grid-cols-[minmax(0,3fr)_5rem_4rem_4rem_6rem_5rem_2rem]" data-testid={`invoice-line-${i}`}>
                  <input aria-label="Description" className={cn(FIELD, "col-span-6 sm:col-span-1")} value={l.description}
                    onChange={(e) => setLine(i, "description", e.target.value)} placeholder="e.g. Cotton polo shirts" data-testid={`invoice-line-desc-${i}`} />
                  <input aria-label="HSN or SAC code" className={cn(FIELD, "col-span-2 sm:col-span-1")} value={l.hsn}
                    onChange={(e) => setLine(i, "hsn", e.target.value)} placeholder="6105" />
                  <input aria-label="Quantity" type="number" inputMode="decimal" className={FIELD} value={l.qty}
                    onChange={(e) => setLine(i, "qty", e.target.value)} data-testid={`invoice-line-qty-${i}`} />
                  <input aria-label="Unit" className={FIELD} value={l.unit} onChange={(e) => setLine(i, "unit", e.target.value)} />
                  <input aria-label="Rate" type="number" inputMode="decimal" className={cn(FIELD, "col-span-2 sm:col-span-1")} value={l.rate}
                    onChange={(e) => setLine(i, "rate", e.target.value)} data-testid={`invoice-line-rate-${i}`} />
                  <GlassSelect variant="field" triggerClassName={cn(FIELD, "col-span-2 sm:col-span-1")} ariaLabel="GST rate"
                    value={sums.exportSale ? "0" : String(l.gst_rate)} onChange={(v) => setLine(i, "gst_rate", v)}
                    options={(meta?.gst_rates || [0, 5, 12, 18, 28]).map((r) => ({ value: String(r), label: `${r}%` }))} />
                  <button type="button" aria-label="Remove line" disabled={f.items.length === 1}
                    onClick={() => setF((s) => ({ ...s, items: s.items.filter((_, x) => x !== i) }))}
                    className="grid h-11 w-8 place-items-center text-slate-400 hover:text-rose-600 disabled:opacity-30">
                    <Trash size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setF((s) => ({ ...s, items: [...s.items, { ...blankLine(meta) }] }))}
                data-testid="invoice-add-line" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700 hover:underline">
                <Plus size={13} weight="bold" aria-hidden="true" /> Add a line
              </button>
            </div>

            <dl className="ml-auto w-full max-w-xs space-y-1 text-sm tabular-nums" data-testid="invoice-totals">
              <div className="flex justify-between"><dt className="text-slate-500">Taxable value</dt><dd>{money(sums.taxable)}</dd></div>
              {sums.exportSale ? (
                <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd>Nil — export under LUT</dd></div>
              ) : sums.intra ? (
                <>
                  <div className="flex justify-between"><dt className="text-slate-500">CGST</dt><dd>{money(sums.tax / 2)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">SGST</dt><dd>{money(sums.tax / 2)}</dd></div>
                </>
              ) : (
                <div className="flex justify-between"><dt className="text-slate-500">IGST</dt><dd>{money(sums.tax)}</dd></div>
              )}
              <div className="flex justify-between border-t border-slate-900/10 pt-1 font-semibold text-slate-900">
                <dt>Total</dt><dd data-testid="invoice-total">{money(sums.total)}</dd>
              </div>
              {foreign && rate > 0 && (
                <div className="flex justify-between text-slate-500">
                  <dt>In {home}</dt><dd data-testid="invoice-total-home">{fmt(home)(sums.total * rate)}</dd>
                </div>
              )}
            </dl>
            <Field label="Notes on the invoice (optional)" htmlFor={`${uid}-notes`}>
              <textarea id={`${uid}-notes`} rows={2} className={AREA} value={f.notes} onChange={(e) => set("notes", e.target.value)}
                placeholder="Payment terms, delivery, LUT number…" />
            </Field>
          </div>
        )}
        <SheetFoot onCancel={close} onSave={save} busy={busy} disabled={!f} testid="invoice-save"
          saveLabel="Raise invoice" busyLabel="Raising…" />
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- F-04 ---- */
export function UseStockDialog({ item, onOpenChange, onDone }) {
  const uid = useId();
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (item) { setQty(""); setNote(""); setDate(today()); } }, [item]);
  const f = fmt(item?.currency || "INR");
  const n = Number(qty) || 0;
  const save = async () => {
    if (!(n > 0)) return toast.error("Enter how much was used");
    setBusy(true);
    try {
      await api.post(`/inventory/${item.id}/use`, { quantity: n, date, note });
      toast.success(`Used ${n} ${item.unit || ""} of ${item.item} — ${f(n * (item.unit_cost || 0))} now counts against profit`);
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(errText(e, "Couldn't record that"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-md")} data-testid="use-stock-dialog">
        <SheetHead icon={Package} title="Use stock"
          description={item ? `${item.item} · ${item.quantity} ${item.unit || ""} in stock at ${f(item.unit_cost)} each` : ""}
          onClose={() => onOpenChange(false)} />
        <div className="space-y-4 px-6 pb-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label={`How much (${item?.unit || "units"})`} htmlFor={`${uid}-qty`}>
              <input id={`${uid}-qty`} data-testid="use-stock-qty" type="number" inputMode="decimal" className={FIELD}
                value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Date" htmlFor={`${uid}-date`}>
              <input id={`${uid}-date`} type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="For (optional)" htmlFor={`${uid}-note`}>
            <input id={`${uid}-note`} className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Order NW-001" />
          </Field>
          {n > 0 && (
            <p className="text-sm text-slate-600" aria-live="polite">
              Cost of this stock: <span className="font-semibold text-slate-900">{f(n * (item?.unit_cost || 0))}</span> — it is
              counted in profit as the cost of what you sold.
            </p>
          )}
        </div>
        <SheetFoot onCancel={() => onOpenChange(false)} onSave={save} busy={busy} testid="use-stock-save"
          saveLabel="Use stock" busyLabel="Saving…" />
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ FX ---- */
/** `invoice` may also be an expense ({kind: "expense"}); the rate is saved on whichever it is. */
export function SetRateDialog({ invoice, home = "INR", onOpenChange, onDone }) {
  const uid = useId();
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (invoice) setRate(invoice.fx_rate ? String(invoice.fx_rate) : ""); }, [invoice]);
  const cur = invoice?.currency || "";
  const n = Number(rate) || 0;
  const save = async () => {
    if (!(n > 0)) return toast.error(`Enter how many ${home} one ${cur} was worth`);
    setBusy(true);
    try {
      const path = invoice.kind === "expense" ? `/expenses/${invoice.id}/fx-rate` : `/invoices/${invoice.id}/fx-rate`;
      const { data } = await api.patch(path, { fx_rate: n });
      toast.success(`Counted as ${fmt(home)(data.amount_base)} in your totals`);
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error(errText(e, "Couldn't save the rate"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-md")} data-testid="set-rate-dialog">
        <SheetHead icon={ArrowsLeftRight} title="Exchange rate"
          description={invoice ? `${invoice.number ? `#${invoice.number} · ` : ""}${invoice.contact_name || invoice.vendor_name || invoice.title || ""} · ${fmt(cur)(invoice.amount)}` : ""}
          onClose={() => onOpenChange(false)} />
        <div className="space-y-3 px-6 pb-5">
          <Field label={`1 ${cur} = how many ${home}`} htmlFor={`${uid}-rate`}>
            <input id={`${uid}-rate`} data-testid="set-rate-input" type="number" inputMode="decimal" className={FIELD}
              value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 107.50" />
          </Field>
          <p className="text-sm text-slate-600" aria-live="polite">
            {n > 0
              ? <>This {invoice?.kind === "expense" ? "expense" : "invoice"} will count as <span className="font-semibold text-slate-900">{fmt(home)((invoice?.amount || 0) * n)}</span> in your totals.</>
              : `Until it has a rate, this ${invoice?.kind === "expense" ? "expense" : "invoice"} is left out of your totals — never counted at face value.`}
          </p>
        </div>
        <SheetFoot onCancel={() => onOpenChange(false)} onSave={save} busy={busy} testid="set-rate-save"
          saveLabel="Save rate" busyLabel="Saving…" />
      </DialogContent>
    </Dialog>
  );
}

/** Invoices left out of the totals because they have no exchange rate yet. */
export function NeedsRateNote({ rows, testid = "needs-rate-note" }) {
  if (!rows || rows.length === 0) return null;
  const parts = rows.map((r) => `${r.count} in ${r.currency} (${fmt(r.currency)(r.amount)})`);
  return (
    <p className="flex items-start gap-2 rounded-[1.25rem] bg-amber-50/90 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-100" data-testid={testid}>
      <WarningCircle size={18} weight="bold" aria-hidden="true" className="mt-px shrink-0" />
      <span>Not in these totals: {parts.join(", ")} — no exchange rate yet. Press “Set rate” on it (Revenue or Expenses).</span>
    </p>
  );
}
