// Finance — the shared glass pieces every Finance surface is built from
// (2026-09-14). One material with Ops, CRM and Team: white glass cards on the
// sky, ink for the action that moves things on, glass pills for the rest,
// tinted chips for status, the gray sheet for dialogs.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Paperclip, Tray, WarningCircle, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { inrCompact } from "../../lib/format";
import { DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { CHIP, DRAWER_FIELD, GLASS_ICON_BTN, GLASS_PILL, GLASS_SHEET, INK_PILL, QUIET_CHIP } from "../../components/karma/glass";

export const CARD = "rounded-[1.6rem] bg-white/75 ring-1 ring-inset ring-white shadow-[0_14px_36px_-18px_hsl(150_15%_20%/0.28),0_1px_2px_hsl(150_15%_20%/0.06)] backdrop-blur-xl";
export const TILE = "rounded-[1.25rem] bg-white/85 ring-1 ring-inset ring-white shadow-[0_8px_22px_-14px_hsl(150_15%_20%/0.3)]";
export const FIELD = cn(DRAWER_FIELD, "h-11 w-full min-w-0 py-0 text-sm");
export const AREA = cn(DRAWER_FIELD, "py-2.5 text-sm");
export const SHEET_CONTENT = cn(
  /* grid-cols-1 (minmax(0, 1fr)) is the actual fix for the phone overflow.
     DialogContent is a CSS grid with no column set, so its one implicit
     column took the WIDEST child's min-content — and FileField's hint is
     `truncate` (nowrap), so that was the full length of the placeholder
     sentence. Every row was laid out that wide; overflow-x-hidden only
     traded the sideways scroll for clipped content (2026-09-15). */
  "max-h-[calc(90dvh/var(--ui-scale,1))] grid-cols-1 gap-0 overflow-y-auto overflow-x-hidden rounded-[1.75rem] p-0 sm:rounded-[1.75rem] [&>button.absolute]:hidden",
  GLASS_SHEET,
);
export const SMALL_PILL = `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium text-slate-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:opacity-50 ${GLASS_PILL}`;
export const SMALL_INK = `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:opacity-50 ${INK_PILL}`;

// The tinted icon circle on a tile: a soft wash, a hairline in the same hue.
export const TONE_CHIP = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  sky: "bg-sky-50 text-sky-700 ring-sky-100",
  orange: "bg-orange-50 text-orange-600 ring-orange-100",
  rose: "bg-rose-50 text-rose-600 ring-rose-100",
  slate: "bg-slate-100 text-slate-600 ring-slate-200/70",
  violet: "bg-violet-50 text-violet-600 ring-violet-100",
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
};

export const fmt = (cur) => (n) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "INR", maximumFractionDigits: 0 }).format(n || 0);
  } catch {
    return `${cur || ""} ${Math.round(n || 0).toLocaleString()}`;
  }
};
/** ₹7.4L for rupees; everything else keeps its full currency format. */
export const compactMoney = (cur) => ((cur || "INR") === "INR" ? inrCompact : fmt(cur));

export function Field({ label, htmlFor, aside, className, children }) {
  return (
    /* min-w-0 — a Field is usually a grid cell, and a grid cell's default
       min-width is its content. Date inputs carry a browser minimum width, so
       a three-up row of them outgrew the dialog on a phone and the whole sheet
       scrolled sideways (2026-09-15). */
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-medium text-slate-600">{label}</label>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function FileField({ file, setFile }) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-900/15 bg-white/55 px-4 py-2.5 text-sm transition-colors hover:bg-white/80 focus-within:ring-2 focus-within:ring-neutral-900/25">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-600 ring-1 ring-inset ring-slate-900/[0.06]">
          <Paperclip size={15} weight="bold" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium text-slate-600">{t("finance.attach_label")}</span>
          <span className="block truncate text-slate-500">{file ? file.name : t("finance.attach_ph")}</span>
        </span>
        <input type="file" accept="image/*,application/pdf" className="sr-only" data-testid="ledger-file-input" onChange={(e) => {
          const sel = e.target.files?.[0] || null;
          e.target.value = "";
          if (sel && sel.size > 15 * 1024 * 1024) { toast.error(t("finance.file_large")); return; }
          if (sel && !/^image\//.test(sel.type) && sel.type !== "application/pdf") { toast.error(t("finance.file_type")); return; }
          setFile(sel);
        }} />
      </label>
      {file && (
        <button type="button" onClick={() => setFile(null)} className="mt-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline">
          {t("finance.remove_attach")}
        </button>
      )}
    </div>
  );
}

export function AttachmentLink({ att }) {
  const { t } = useTranslation();
  if (!att?.url) return null;
  return (
    <a href={`${process.env.REACT_APP_BACKEND_URL}${att.url}`} target="_blank" rel="noopener noreferrer" data-testid="view-attachment"
      className="ml-1.5 inline-flex items-center gap-1 rounded-pill px-2 py-0.5 align-middle text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-900/[0.08] hover:bg-white hover:text-slate-900">
      <Paperclip size={11} weight="bold" aria-hidden="true" /> {t("finance.bill")}
    </a>
  );
}

/** The dialog header on the gray sheet: icon tile, title, one line, close. */
export function SheetHead({ icon: Icon, title, description, onClose }) {
  return (
    <div className="flex items-start gap-4 p-6 pb-4">
      {Icon && (
        <span className={`grid h-12 w-12 shrink-0 place-items-center text-slate-700 ${TILE}`}>
          <Icon size={22} aria-hidden="true" />
        </span>
      )}
      <DialogHeader className="min-w-0 flex-1 space-y-1 text-left">
        <DialogTitle className="text-xl font-semibold text-neutral-900">{title}</DialogTitle>
        <DialogDescription className={description ? "text-sm text-neutral-600" : "sr-only"}>{description || title}</DialogDescription>
      </DialogHeader>
      <button type="button" onClick={onClose} aria-label="Close" className={GLASS_ICON_BTN}>
        <X size={16} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

export function SheetFoot({ onCancel, onSave, busy, disabled, saveLabel, busyLabel, testid }) {
  return (
    <div className="flex items-center justify-end gap-2.5 border-t border-slate-900/[0.06] px-6 py-4">
      <button type="button" onClick={onCancel} className={`h-11 rounded-pill px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
        Cancel
      </button>
      <button type="button" onClick={onSave} disabled={busy || disabled} data-testid={testid}
        className={`h-11 rounded-pill px-6 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
        {busy ? busyLabel : saveLabel}
      </button>
    </div>
  );
}

export const TONE = {
  good: "bg-emerald-50 text-emerald-800 ring-emerald-100",
  warn: "bg-amber-50 text-amber-800 ring-amber-100",
  bad: "bg-rose-50 text-rose-700 ring-rose-100",
  info: "bg-sky-50 text-sky-800 ring-sky-100",
  quiet: QUIET_CHIP,
};

export function Tag({ tone = "quiet", className, children, ...rest }) {
  return <span className={cn(CHIP, TONE[tone], "capitalize", className)} {...rest}>{children}</span>;
}

/** Where a record came from — metadata, so always the quiet chip. */
export function SourceTag({ source }) {
  if (!source || source === "manual") return null;
  return <Tag className="ml-1.5 align-middle">{String(source).replace(/_/g, " ")}</Tag>;
}

export function CardHead({ icon: Icon, title, sub, action, className }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className={`grid h-10 w-10 shrink-0 place-items-center text-slate-700 ${TILE}`}>
            <Icon size={20} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          {sub && <p className="text-sm text-slate-500">{sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function EmptyNote({ icon: Icon = Tray, title, hint, className }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-10 text-center", className)}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-900/[0.04] text-slate-400">
        <Icon size={22} aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {hint && <p className="max-w-sm text-sm leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

// FN-07 / FN-09 — a query that fails (most often a 403 for a role without the
// ledger permission) says so, instead of an empty table or "Loading…" forever.
export function LoadError({ title = "Couldn't load this", hint = "You may not have access to these records, or the connection dropped. Try again in a moment." }) {
  return (
    <div role="alert" className={`flex items-start gap-3 p-5 ${CARD}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100">
        <WarningCircle size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-sm text-slate-500">{hint}</p>
      </div>
    </div>
  );
}

/**
 * The change chip: an arrow, the signed percentage, and a screen-reader
 * sentence naming the comparison. Green or red only when the movement is
 * good or bad news; a balance (assets, stock) moves in neutral ink.
 */
export function DeltaChip({ change, goodWhenUp = true, neutral = false, prevLabel, testid }) {
  if (!change) return null;
  const { pct, direction, fresh } = change;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;
  const good = neutral || direction === "flat" ? null : (direction === "up") === goodWhenUp;
  const tone = good === null ? "text-slate-500" : good ? "text-emerald-700" : "text-rose-600";
  const text = fresh ? "New" : `${pct > 0 ? "+" : ""}${pct}%`;
  const said = fresh
    ? `Nothing in ${prevLabel} to compare with`
    : `${direction === "up" ? "Up" : direction === "down" ? "Down" : "No change"}${direction === "flat" ? "" : ` ${Math.abs(pct)}%`} against ${prevLabel}`;
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold ${tone}`} title={said} data-testid={testid}>
      <Icon size={13} weight="bold" aria-hidden="true" />
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{said}</span>
    </span>
  );
}

const SPARK_TONE = {
  emerald: ["stroke-emerald-600", "fill-emerald-500/10"],
  sky: ["stroke-sky-500", "fill-sky-500/10"],
  orange: ["stroke-orange-500", "fill-orange-500/10"],
  slate: ["stroke-slate-400", "fill-slate-400/10"],
  violet: ["stroke-violet-500", "fill-violet-500/10"],
  amber: ["stroke-amber-600", "fill-amber-600/10"],
};

/** A 2px line over a 10% wash, from real points only; fewer than two draws nothing. */
export function Sparkline({ points, tone = "slate", label, className }) {
  const vals = (points || []).map(Number).filter(Number.isFinite);
  if (vals.length < 2) return null;
  const W = 120;
  const H = 36;
  const pad = 3;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min;
  const x = (i) => (i / (vals.length - 1)) * W;
  const y = (v) => (span ? pad + (1 - (v - min) / span) * (H - pad * 2) : max ? H / 2 : H - pad);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const [stroke, fill] = SPARK_TONE[tone] || SPARK_TONE.slate;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}
      className={cn("block h-9 w-full overflow-visible", className)}>
      <path d={`${line} L${W},${H} L0,${H} Z`} className={cn(fill, "stroke-none")} />
      <path d={line} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={stroke} />
    </svg>
  );
}
