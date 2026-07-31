import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { Chip, EmptyState } from "../components/common";
import { money, typeLabel } from "../lib/format";
import { toast } from "sonner";
import {
  ArrowLeft, Phone, EnvelopeSimple, MapPin, Receipt, CurrencyCircleDollar,
  Warning, Truck, TrendUp, Brain, CheckSquare, Buildings, Sparkle, Heart, ShieldWarning,
} from "@phosphor-icons/react";

const Stat = ({ label, value, accent, testid }) => (
  <div className="rounded-lg border border-hairline bg-surface p-4" data-testid={testid}>
    <p className="text-label text-text-secondary">{label}</p>
    <p className={` text-2xl font-black tracking-tight mt-1 ${accent || ""}`}>{value}</p>
  </div>
);

const Section = ({ icon: Icon, title, count, children }) => (
  <div className="mb-8">
    <div className="flex items-center gap-2 mb-3">
      <Icon size={18} weight="bold" className="text-primary-text" />
      <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
      {count != null && <span className="text-label text-text-secondary">({count})</span>}
    </div>
    {children}
  </div>
);

function Table({ head, rows }) {
  return (
    <div className="overflow-x-auto border border-hairline bg-surface rounded-md">
      <table className="w-full text-sm">
        <thead className="bg-primary text-primary-foreground"><tr>{head.map((h) => <th key={h} className="text-left px-3 py-2 text-label">{h}</th>)}</tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

export default function ContactProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canView = hasPerm(user, "finance");
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["contact-profile", id],
    queryFn: () => api.get(`/contacts/${id}/profile`).then((r) => r.data),
    enabled: canView,
    retry: false,
  });

  const rescore = useMutation({
    mutationFn: () => api.post(`/contacts/${id}/rescore`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contact-profile", id] });
      toast.success("Relationship scored by AI");
    },
    onError: () => toast.error("Could not score right now"),
  });

  if (!canView) return <EmptyState title="Restricted" hint="The 360° profile is available to Owner and Finance only." />;
  if (isLoading) return <div className="text-label text-sm py-20 text-center">Loading profile…</div>;
  if (error) return <EmptyState title="Not found" hint="This contact could not be loaded." />;

  const { contact: c, summary, invoices, payments, complaints, pending_deliveries, follow_ups, decisions, price_history, ai_relationship } = data;
  const isVendor = c.type === "vendor";
  const cur = invoices?.[0]?.currency || "INR";
  const rel = ai_relationship;

  const ScoreBox = ({ label, value, Icon, good }) => {
    const color = value == null ? "text-text-tertiary" : good ? (value >= 60 ? "text-status-completed-fg" : value >= 30 ? "text-status-pending-fg" : "text-primary-text")
      : (value >= 60 ? "text-primary-text" : value >= 30 ? "text-status-pending-fg" : "text-status-completed-fg");
    return (
      <div className="flex items-center gap-3" data-testid={`rel-${label.toLowerCase()}`}>
        <div className="w-14 h-14 flex flex-col items-center justify-center border-2 border-hairline bg-surface shrink-0 rounded-md">
          <span className={` text-2xl font-black leading-none ${color}`}>{value != null ? value : "—"}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-semibold tracking-wide">
          <Icon size={16} weight="bold" className="text-text-secondary" /> {label}
        </div>
      </div>
    );
  };

  return (
    <div>
      <button onClick={() => navigate("/contacts")} data-testid="profile-back" className="flex items-center gap-2 text-sm font-semibold mb-4 hover:text-destructive-text transition-colors">
        <ArrowLeft size={16} weight="bold" /> Back to People
      </button>

      {/* Header */}
      <div className="rounded-lg border border-hairline bg-surface p-6 mb-6" data-testid="profile-header">
        <div className="flex items-center gap-2 mb-2">
          <Chip value={typeLabel(c.type)} className={c.type === "customer" ? "bg-primary text-primary-foreground" : "bg-status-pending-bg text-text"} />
          <Chip value={c.status} />
        </div>
        <h1 className="text-4xl font-black tracking-tighter">{c.name}</h1>
        {c.company && <p className="text-text-secondary flex items-center gap-2 mt-1"><Buildings size={14} weight="bold" /> {c.company}</p>}
        <div className="flex flex-wrap gap-4 mt-3 text-sm">
          {c.phone && <span className="flex items-center gap-1.5"><Phone size={14} weight="bold" className="text-text-secondary" /> {c.phone}</span>}
          {c.email && <span className="flex items-center gap-1.5"><EnvelopeSimple size={14} weight="bold" className="text-text-secondary" /> {c.email}</span>}
          {c.address && <span className="flex items-center gap-1.5"><MapPin size={14} weight="bold" className="text-text-secondary" /> {c.address}</span>}
          {c.tax_id && <span className="text-label text-text-secondary">{c.tax_id}</span>}
        </div>
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <Stat testid="stat-outstanding" label="Outstanding" value={money(summary.outstanding, cur)} accent={summary.outstanding > 0 ? "text-primary-text" : "text-text"} />
        <Stat testid="stat-billed" label={isVendor ? "Total Billed" : "Total Invoiced"} value={money(summary.total_billed, cur)} />
        <Stat testid="stat-paid" label="Total Paid" value={money(summary.total_paid, cur)} />
        <Stat testid="stat-complaints" label="Open Complaints" value={summary.open_complaints} accent={summary.open_complaints > 0 ? "text-text-secondary" : ""} />
      </div>

      {/* AI Relationship Intelligence */}
      <div className="rounded-lg border border-hairline bg-surface p-6 mb-8" data-testid="relationship-card">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <div className="flex items-center gap-2">
            <Sparkle size={18} weight="bold" className="text-primary-text" />
            <h2 className="text-xl font-extrabold tracking-tight">Relationship Intelligence</h2>
          </div>
          <button
            onClick={() => rescore.mutate()}
            disabled={rescore.isPending}
            data-testid="rescore-contact-btn"
            className="flex items-center gap-2 border border-hairline px-4 py-2 text-sm font-semibold bg-status-pending-bg hover:shadow-xs transition-all disabled:opacity-50 rounded-md"
          >
            <Sparkle size={16} weight="bold" /> {rescore.isPending ? "Scoring…" : rel ? "Re-score" : "Score with AI"}
          </button>
        </div>
        {!rel ? (
          <p className="text-sm text-text-secondary">No AI assessment yet. Click "Score with AI" to analyze this relationship's health and risk.</p>
        ) : (
          <div>
            <div className="flex flex-wrap gap-8">
              <ScoreBox label="Relationship" value={rel.relationship_score} Icon={Heart} good />
              <ScoreBox label="Risk" value={rel.risk_score} Icon={ShieldWarning} good={false} />
            </div>
            {rel.reason && <p className="text-sm mt-4 italic text-text-secondary">{rel.reason}</p>}
            {(rel.signals || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3" data-testid="rel-signals">
                {rel.signals.map((s, i) => (
                  <span key={`sig-${i}-${s.slice(0, 20)}`} className="inline-block px-2 py-0.5 text-xs border border-hairline bg-surface rounded-md">{s}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Section icon={Receipt} title={isVendor ? "Purchase Bills" : "Sales Bills"} count={invoices.length}>
        {invoices.length === 0 ? <p className="text-sm text-text-secondary">No bills recorded.</p> : (
          <Table head={["Number", "Amount", "Date", "Due", "Status"]} rows={invoices.map((inv) => (
            <tr key={inv.id} data-testid={`profile-invoice-${inv.id}`} className="border-t-hairline">
              <td className="px-3 py-2 text-label">{inv.number || "—"}</td>
              <td className="px-3 py-2 font-semibold">{money(inv.amount, inv.currency)}</td>
              <td className="px-3 py-2 text-label text-xs">{inv.date || "—"}</td>
              <td className="px-3 py-2 text-label text-xs">{inv.due_date || "—"}</td>
              <td className="px-3 py-2"><Chip value={inv.status} /></td>
            </tr>
          ))} />
        )}
      </Section>

      <Section icon={CurrencyCircleDollar} title="Payments" count={payments.length}>
        {payments.length === 0 ? <p className="text-sm text-text-secondary">No payments recorded.</p> : (
          <Table head={["Direction", "Amount", "Method", "Reference", "Date"]} rows={payments.map((p) => (
            <tr key={p.id} data-testid={`profile-payment-${p.id}`} className="border-t-hairline">
              <td className="px-3 py-2"><Chip value={p.direction === "in" ? "received" : "paid"} className={p.direction === "in" ? "bg-primary text-primary-foreground" : "bg-status-pending-bg text-text"} /></td>
              <td className="px-3 py-2 font-semibold">{money(p.amount, p.currency)}</td>
              <td className="px-3 py-2">{p.method || "—"}</td>
              <td className="px-3 py-2 text-label text-xs">{p.reference || "—"}</td>
              <td className="px-3 py-2 text-label text-xs">{p.date || "—"}</td>
            </tr>
          ))} />
        )}
      </Section>

      {isVendor && (
        <Section icon={Truck} title="Pending Deliveries" count={pending_deliveries.length}>
          {pending_deliveries.length === 0 ? <p className="text-sm text-text-secondary">Nothing pending.</p> : (
            <div className="space-y-2">{pending_deliveries.map((w) => (
              <div key={w.id} className="border border-hairline bg-surface p-3 flex items-center justify-between gap-2 rounded-md">
                <span className="text-sm font-semibold">{w.title}</span><Chip value={w.stage} />
              </div>
            ))}</div>
          )}
        </Section>
      )}

      {isVendor && price_history.length > 0 && (
        <Section icon={TrendUp} title="Price History" count={price_history.length}>
          <Table head={["Item", "Rate", "Date"]} rows={price_history.map((h, i) => (
            <tr key={`${h.item || "row"}-${h.date || ""}-${i}`} className="border-t-hairline">
              <td className="px-3 py-2">{h.item}</td>
              <td className="px-3 py-2 font-semibold">{money(h.rate, cur)}</td>
              <td className="px-3 py-2 text-label text-xs">{h.date || "—"}</td>
            </tr>
          ))} />
        </Section>
      )}

      <Section icon={CheckSquare} title="Follow-ups & Tasks" count={follow_ups.length}>
        {follow_ups.length === 0 ? <p className="text-sm text-text-secondary">No follow-ups.</p> : (
          <div className="space-y-2">{follow_ups.map((t) => (
            <div key={t.id} className="border border-hairline bg-surface p-3 flex items-center justify-between gap-2 rounded-md">
              <span className="text-sm">{t.title}</span>
              <div className="flex gap-1.5">{t.assignee_role && <Chip value={t.assignee_role} />}<Chip value={t.status} /></div>
            </div>
          ))}</div>
        )}
      </Section>

      <Section icon={Warning} title="Complaints" count={complaints.length}>
        {complaints.length === 0 ? <p className="text-sm text-text-secondary">No complaints logged.</p> : (
          <div className="space-y-2">{complaints.map((cp) => (
            <div key={cp.id} data-testid={`profile-complaint-${cp.id}`} className="border border-hairline bg-surface p-3 rounded-md">
              <div className="flex items-center gap-2 mb-1"><Chip value={cp.severity} /><Chip value={cp.status} /></div>
              <p className="text-sm">{cp.text}</p>
            </div>
          ))}</div>
        )}
      </Section>

      <Section icon={Brain} title="Linked Decisions" count={decisions.length}>
        {decisions.length === 0 ? <p className="text-sm text-text-secondary">No linked decisions.</p> : (
          <div className="space-y-2">{decisions.map((d) => (
            <div key={d.id} className="border border-hairline bg-surface p-3 rounded-md">
              <div className="flex items-center gap-2 mb-1"><Chip value={d.status} />{d.dtype && <Chip value={d.dtype} />}</div>
              <p className="text-sm font-semibold">{d.title}</p>
              {d.summary && <p className="text-xs text-text-secondary">{d.summary}</p>}
            </div>
          ))}</div>
        )}
      </Section>
    </div>
  );
}
