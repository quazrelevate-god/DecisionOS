import { cn } from "../lib/utils";

export function PageHeader({ eyebrow, title, children }) {
  return (
    <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
      <div>
        {eyebrow && <p className="label-mono text-brand-red mb-2">{eyebrow}</p>}
        <h1 className="font-heading text-4xl lg:text-5xl font-black uppercase tracking-tighter">{title}</h1>
      </div>
      {children}
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
};

export function Chip({ value, className = "", ...rest }) {
  const style = STATUS_STYLES[value] || "bg-white text-black";
  return (
    <span
      className={cn(
        "inline-block px-2 py-0.5 text-xs uppercase tracking-wider font-semibold border border-black",
        style,
        className
      )}
      {...rest}
    >
      {String(value || "").replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <div className="border border-dashed border-black/40 p-12 text-center">
      <p className="font-heading font-bold uppercase tracking-tight text-lg">{title}</p>
      {hint && <p className="text-sm text-muted-foreground mt-2">{hint}</p>}
    </div>
  );
}
