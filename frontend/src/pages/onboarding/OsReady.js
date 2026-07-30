import { CheckCircle, Buildings, Kanban, ListChecks, ShieldCheck, ArrowRight } from "@phosphor-icons/react";

export function OsReady({ industryLabel, summary, onContinue }) {
  const cards = [
    { icon: Buildings, n: summary.departments, label: "Departments Created" },
    { icon: Kanban, n: summary.workflows, label: "Workflows Installed" },
    { icon: ListChecks, n: summary.operational_tasks, label: "Operational Tasks Added" },
    { icon: ShieldCheck, n: summary.approval_rules, label: "Approval Rules Configured" },
  ];
  return (
    <div className="space-y-5" data-testid="onboarding-os-ready">
      <div className="border border-hairline bg-primary text-primary-foreground p-5">
        <CheckCircle size={28} weight="fill" className="text-primary-text mb-2" />
        <h3 className="text-2xl font-black uppercase tracking-tighter leading-tight" data-testid="os-ready-title">
          Your {industryLabel || "Business"} Operating System is Ready.
        </h3>
        <p className="text-white/70 text-sm mt-1">A ready-to-use workspace has been provisioned. Everything below is editable anytime.</p>
      </div>
      <div className="grid grid-cols-2 gap-3" data-testid="os-summary">
        {cards.map((s) => (
          <div key={s.label} data-testid={`os-summary-${s.label.split(" ")[0].toLowerCase()}`} className="border border-hairline bg-surface p-4">
            <s.icon size={20} weight="bold" className="text-primary-text mb-1.5" />
            <p className="text-3xl font-black leading-none">{s.n}</p>
            <p className="text-label uppercase text-text-secondary mt-1">{s.label}</p>
          </div>
        ))}
      </div>
      <button data-testid="os-ready-continue" onClick={onContinue} className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold uppercase tracking-wider py-3 border border-hairline hover:shadow-sm transition-all">
        Continue <ArrowRight size={16} weight="bold" />
      </button>
    </div>
  );
}
