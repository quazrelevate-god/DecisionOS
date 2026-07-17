import { cn } from "../lib/utils";

export function PageHeader({ eyebrow, title, children }) {
  return (
    <div className="mb-8">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="flex items-center gap-2 mb-3">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-brand-red opacity-60 animate-ping"></span>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-red"></span>
              </span>
              <p className="label-mono text-muted-foreground">{eyebrow}</p>
            </div>
          )}
          <h1 className="font-heading text-3xl sm:text-[2.25rem] lg:text-[2.6rem] font-bold tracking-[-0.035em] leading-[1.05] text-foreground">
            {title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto lg:justify-end">{children}</div>
      </div>
      <div className="mt-5 h-px w-full bg-gradient-to-r from-brand-red/50 via-border to-transparent"></div>
    </div>
  );
}

const STATUS_STYLES = {
  pending_approval: "bg-brand-yellow text-black",
  approved: "bg-brand-blue text-white",
  rejected: "bg-black text-white",
  blocked: "bg-black/10 text-black",
  todo: "bg-white text-black",
  in_progress: "bg-brand-blue text-white",
  done: "bg-brand-ink text-white",
  cancelled: "bg-black/10 text-muted-foreground line-through",
  high: "bg-brand-red text-white",
  medium: "bg-brand-yellow text-black",
  low: "bg-black/10 text-black",
  overdue: "bg-brand-red text-white",
  decision: "bg-brand-blue text-white",
  purchase: "bg-brand-yellow text-black",
  owner: "bg-brand-red text-white",
  sales: "bg-white text-black",
  production: "bg-white text-black",
  finance: "bg-white text-black",
  sales_dispatch: "bg-brand-yellow text-black",
  purchase_payment: "bg-brand-yellow text-black",
  directive: "bg-brand-blue text-white",
  approval: "bg-brand-blue text-white",
  policy: "bg-brand-ink text-white",
  observation: "bg-black/10 text-black",
};

const STATUS_LABELS = {
  blocked: "pending approval",
};

export function Chip({ value, className = "", ...rest }) {
  const style = STATUS_STYLES[value] || "bg-white text-black";
  const label = STATUS_LABELS[value] || String(value || "").replace(/_/g, " ");
  return (
    <span
      className={cn(
        "inline-block px-2 py-0.5 text-xs uppercase tracking-wider font-semibold border border-black",
        style,
        className
      )}
      {...rest}
    >
      {label}
    </span>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <div className="border border-dashed border-border rounded-xl p-12 text-center bg-card/40">
      <p className="font-heading font-semibold tracking-tight text-lg">{title}</p>
      {hint && <p className="text-sm text-muted-foreground mt-2">{hint}</p>}
    </div>
  );
}
