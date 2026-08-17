import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import ContactProfileMobile from "./mobile/ContactProfileMobile";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { Chip, EmptyState, DexBadge } from "../components/common";
import { money, typeLabel } from "../lib/format";
import { toast } from "sonner";
import {
  ArrowLeft, Phone, EnvelopeSimple, MapPin, Receipt, CurrencyCircleDollar,
  Warning, Truck, TrendUp, Brain, CheckSquare, Buildings, Sparkle, Heart, ShieldWarning,
  Note, Clock, ChatCircleDots, WhatsappLogo, Handshake, FlowArrow,
} from "@phosphor-icons/react";

// Epic 2 Sprint 1 (E2-08): activity kind -> icon + colour. Small map
// so the timeline reads at a glance.
const ACTIVITY_META = {
  call: { icon: Phone, label: "Call", cls: "bg-brand-blue text-white" },
  meeting: { icon: Handshake, label: "Meeting", cls: "bg-caution-50 text-caution-800" },
  note: { icon: Note, label: "Note", cls: "bg-black/10 text-black" },
  whatsapp: { icon: WhatsappLogo, label: "WhatsApp", cls: "bg-brand-green text-white" },
  email: { icon: EnvelopeSimple, label: "Email", cls: "bg-muted text-muted-foreground" },
  other: { icon: ChatCircleDots, label: "Other", cls: "bg-black/10 text-black" },
};

function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// RD-3 (2026-08-17): the KPI tile, matching the reference's stat card —
// small muted caption above a large, lightly-weighted number. Was
// font-black/tracking-tight, which made a row of tiles read as a scoreboard.
const Stat = ({ label, value, accent, testid }) => (
  <div className="card-brutal p-4" data-testid={testid}>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className={`text-2xl font-medium tabular-nums mt-1.5 ${accent || ""}`}>{value}</p>
  </div>
);

// U7-07 (2026-08-17): Section now supports `hideWhenEmpty` -- if the
// count is 0 AND this flag is set, render nothing. Killed "No payments
// recorded" style empty sections that were pure noise on healthy accounts.
// Sections with an inline logger (Recent Activity) skip this flag.
const Section = ({ icon: Icon, title, count, children, hideWhenEmpty = false }) => {
  if (hideWhenEmpty && !count) return null;
  return (
    <div className="mb-8">
      {/* RD-3: section heading drops uppercase/extrabold for a plain
          medium-weight line; the count moves into a quiet pill instead of
          parentheses. The icon stays indigo — it is the only accent here. */}
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className="text-brand-600" />
        <h2 className="text-sm font-medium">{title}</h2>
        {count != null && (
          <span className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] tabular-nums">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
};

function Table({ head, rows }) {
  // RD-3: the header row was a solid dark bar with mono caps — it read as a
  // terminal table. The reference uses muted grey header text on the card
  // ground with a single hairline beneath.
  return (
    <div className="overflow-x-auto nm-raised">
      <table className="w-full text-sm">
        <thead className="bg-nm-sunken border-b border-nm-edge/30">
          <tr>
            {head.map((h) => (
              <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

export default function ContactProfile() {
  // MPWA-10: rebuilt below lg (§8); desktop tree untouched.
  const isMobile = useIsMobile();
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

  // Epic 2 Sprint 1 (E2-08): CRM activity timeline.
  const canWriteActivity = user?.role === "owner" || user?.role === "sales";
  const { data: activities } = useQuery({
    queryKey: ["crm-activity", id],
    queryFn: () => api.get(`/crm/activity/${id}`).then((r) => r.data),
    enabled: canView,
  });
  const [actKind, setActKind] = useState("call");
  const [actText, setActText] = useState("");
  const logActivity = useMutation({
    mutationFn: () => api.post(`/crm/activity/${id}`, { kind: actKind, text: actText.trim() }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-activity", id] });
      // Bump "last touched" pill on the /crm card grid too
      qc.invalidateQueries({ queryKey: ["crm-contacts"] });
      setActText(""); setActKind("call");
      toast.success("Activity logged");
    },
    onError: (e) => toast.error(e.response?.data?.detail || "Could not save"),
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
  if (isLoading) return <div className="text-sm text-muted-foreground py-20 text-center">Loading profile…</div>;
  // MPWA-12i: a dead end is worst on an error path — he arrived from a link and
  // has nowhere to go. E2-13's own CTA, on the surface it missed.
  // `!data?.contact` as well as `error`: the API answers 200 with an empty body
  // for a contact that no longer exists, and the destructure below reads
  // `c.type` — which threw "Cannot read properties of undefined" and took the
  // whole page down rather than showing this state.
  if (error || !data?.contact) {
    return (
      <EmptyState
        title="That contact isn't here."
        hint="It may have been merged or removed. Everyone else is still in People."
        ctaLabel="+ Back to People"
        ctaTo="/crm"
      />
    );
  }

  const { contact: c, summary, invoices: rawInvoices, payments: rawPayments, complaints: rawComplaints, pending_deliveries, workflows: rawWorkflows, follow_ups, decisions, price_history, ai_relationship } = data;
  const isVendor = c.type === "vendor";
  // U7-07 (2026-08-17): dedupe by id on the frontend. Backend was
  // returning duplicate complaint rows (visible in the Anand Fabrics
  // profile -- same "shade mismatch" listed twice). Belt-and-braces
  // dedupe until the backend fix lands.
  const dedupe = (arr) => {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    return arr.filter((x) => {
      if (!x?.id || seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  };
  const invoices = dedupe(rawInvoices);
  const payments = dedupe(rawPayments);
  const complaints = dedupe(rawComplaints);
  const workflows = dedupe(rawWorkflows);
  const cur = invoices?.[0]?.currency || "INR";
  const rel = ai_relationship;

  const ScoreBox = ({ label, value, Icon, good }) => {
    const color = value == null ? "text-muted-foreground" : good ? (value >= 60 ? "text-green-600" : value >= 30 ? "text-amber-600" : "text-brand-600")
      : (value >= 60 ? "text-brand-600" : value >= 30 ? "text-amber-600" : "text-green-600");
    return (
      <div className="flex items-center gap-3" data-testid={`rel-${label.toLowerCase()}`}>
        <div className="w-14 h-14 flex flex-col items-center justify-center rounded-xl border border-border bg-card shrink-0">
          <span className={`text-2xl font-medium tabular-nums leading-none ${color}`}>{value != null ? value : "—"}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Icon size={16} weight="bold" className="text-muted-foreground" /> {label}
        </div>
      </div>
    );
  };

  if (isMobile) return <ContactProfileMobile />;

  return (
    <div>
      {/* U7-07: label matches the nav item ("CRM") + route lands on
          /crm directly instead of hitting the redirect. */}
      <button onClick={() => navigate("/crm")} data-testid="profile-back" className="flex items-center gap-2 text-sm text-muted-foreground mb-5 hover:text-foreground transition-colors">
        <ArrowLeft size={16} weight="bold" /> Back to CRM
      </button>

      {/* Header */}
      <div className="card-brutal p-6 mb-6" data-testid="profile-header">
        <div className="flex items-center gap-2 mb-2">
          <Chip value={typeLabel(c.type)} className={c.type === "customer" ? "bg-brand-50 text-brand-700" : "bg-muted text-muted-foreground"} />
          <Chip value={c.status} />
        </div>
        <h1 className="font-display text-3xl">{c.name}</h1>
        {c.company && <p className="text-muted-foreground flex items-center gap-2 mt-1"><Buildings size={14} weight="bold" /> {c.company}</p>}
        <div className="flex flex-wrap gap-4 mt-3 text-sm">
          {c.phone && <span className="flex items-center gap-1.5"><Phone size={14} weight="bold" className="text-muted-foreground" /> {c.phone}</span>}
          {c.email && <span className="flex items-center gap-1.5"><EnvelopeSimple size={14} weight="bold" className="text-muted-foreground" /> {c.email}</span>}
          {c.address && <span className="flex items-center gap-1.5"><MapPin size={14} weight="bold" className="text-muted-foreground" /> {c.address}</span>}
          {c.tax_id && <span className="font-mono text-muted-foreground">{c.tax_id}</span>}
        </div>
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <Stat testid="stat-outstanding" label="Outstanding" value={money(summary.outstanding, cur)} accent={summary.outstanding > 0 ? "text-brand-600" : "text-foreground"} />
        <Stat testid="stat-billed" label={isVendor ? "Total Billed" : "Total Invoiced"} value={money(summary.total_billed, cur)} />
        <Stat testid="stat-paid" label="Total Paid" value={money(summary.total_paid, cur)} />
        <Stat testid="stat-complaints" label="Open Complaints" value={summary.open_complaints} accent={summary.open_complaints > 0 ? "text-purple-600" : ""} />
      </div>

      {/* U7-07 (2026-08-17): AI Relationship Intelligence -- when
          NOT scored, was a big card just saying "no assessment yet".
          Now a subtle inline prompt when empty; expands into the full
          card only when there's actually a score to show. */}
      {!rel ? (
        /* RD-3: this is an OFFER, not a warning — it was picked up by the
           brand-yellow sweep and landed on a caution tint, which told the
           user something was wrong when nothing is. Neutral hairline card;
           the DexBadge already supplies the only accent it needs. */
        <div
          className="border border-border rounded-xl px-4 py-3 mb-8 flex items-center justify-between gap-3 flex-wrap bg-card"
          data-testid="relationship-card"
        >
          <div className="flex items-center gap-2 text-sm">
            <DexBadge />
            <span className="text-muted-foreground">Analyze this relationship's health &amp; risk with AI.</span>
          </div>
          <button
            onClick={() => rescore.mutate()}
            disabled={rescore.isPending}
            data-testid="rescore-contact-btn"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Sparkle size={14} weight="bold" /> {rescore.isPending ? "Scoring…" : "Score with AI"}
          </button>
        </div>
      ) : (
        <div className="card-brutal p-6 mb-8" data-testid="relationship-card">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <div className="flex items-center gap-2">
              <DexBadge />
              <h2 className="text-sm font-medium">Relationship Intelligence</h2>
            </div>
            <button
              onClick={() => rescore.mutate()}
              disabled={rescore.isPending}
              data-testid="rescore-contact-btn"
              className="flex items-center gap-2 border border-border px-4 py-2 text-sm font-medium bg-card transition-all disabled:opacity-50"
            >
              <Sparkle size={16} weight="bold" /> {rescore.isPending ? "Scoring…" : "Re-score"}
            </button>
          </div>
          <div>
            <div className="flex flex-wrap gap-8">
              <ScoreBox label="Relationship" value={rel.relationship_score} Icon={Heart} good />
              <ScoreBox label="Risk" value={rel.risk_score} Icon={ShieldWarning} good={false} />
            </div>
            {rel.reason && <p className="text-sm mt-4 italic text-muted-foreground">{rel.reason}</p>}
            {(rel.signals || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3" data-testid="rel-signals">
                {rel.signals.map((s, i) => (
                  <span key={`sig-${i}-${s.slice(0, 20)}`} className="inline-block px-2 py-0.5 rounded-md text-xs bg-muted text-muted-foreground">{s}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* E2-08: Activity timeline. Small logger + list. Owner + sales
          may log; anyone with finance perm can view. */}
      {/* NM-5 (§3 Layout): Recent Activity and Workflows share a 2-col grid
          at ≥ xl, stacked below. items-start so a short Workflows card does
          not stretch to the activity column's height. Workflows hides itself
          when empty (U7-07), leaving Activity a single tidy column. */}
      <div className="xl:grid xl:grid-cols-2 xl:gap-5 xl:items-start">
      <Section icon={ChatCircleDots} title="Recent Activity" count={(activities || []).length}>
        {canWriteActivity && (
          <div className="nm-tile p-3 mb-3 flex flex-col md:flex-row gap-2" data-testid="crm-activity-logger">
            <select
              value={actKind}
              onChange={(e) => setActKind(e.target.value)}
              data-testid="crm-activity-kind"
              className="nm-inset px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {Object.entries(ACTIVITY_META).map(([k, m]) => (
                <option key={k} value={k}>{m.label}</option>
              ))}
            </select>
            <input
              value={actText}
              onChange={(e) => setActText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && actText.trim()) logActivity.mutate(); }}
              placeholder="What happened? (e.g. 'Rang about Rs 8L invoice, promised payment by Friday')"
              data-testid="crm-activity-text"
              className="flex-1 nm-inset px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              onClick={() => actText.trim() && logActivity.mutate()}
              disabled={!actText.trim() || logActivity.isPending}
              data-testid="crm-activity-save"
              className="bg-primary text-primary-foreground rounded-control shadow-nm-sm px-4 py-2 text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:shadow-none"
            >
              {logActivity.isPending ? "Saving…" : "Log"}
            </button>
          </div>
        )}
        {(!activities || activities.length === 0) ? (
          <p className="text-sm text-muted-foreground">No calls / meetings / notes logged yet.{canWriteActivity ? " Log the first one above." : ""}</p>
        ) : (
          <div className="space-y-2">
            {activities.map((a) => {
              const meta = ACTIVITY_META[a.kind] || ACTIVITY_META.other;
              const Icon = meta.icon;
              return (
                <div key={a.id} data-testid={`crm-activity-${a.id}`} className="nm-inset p-3">
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                      <Icon size={12} weight="bold" /> {meta.label}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono ml-auto flex items-center gap-1">
                      <Clock size={11} weight="bold" /> {timeAgo(a.created_at)}
                    </span>
                  </div>
                  <p className="text-sm">{a.text}</p>
                  {a.actor_name && <p className="text-[11px] text-muted-foreground mt-1 font-mono">— {a.actor_name}</p>}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* U7-07: display-only sections use hideWhenEmpty. Was rendering
          an "empty state" per section (No workflows, No payments, No
          complaints, No linked decisions, etc.) -- that turned a
          healthy new contact into 6 stacked "nothing here" bands.
          Now: hidden when empty. Section header only appears when
          there's actually data to show. */}

      <Section icon={FlowArrow} title="Workflows" count={workflows.length} hideWhenEmpty>
        <div className="space-y-2">
          {workflows.map((w) => (
            <div key={w.id} data-testid={`crm-workflow-${w.id}`} className="nm-inset p-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{w.title || "(untitled)"}</p>
                <p className="text-xs text-muted-foreground font-mono">{w.type} · created {timeAgo(w.created_at)}</p>
              </div>
              <Chip value={w.stage || "unknown"} />
            </div>
          ))}
        </div>
      </Section>
      </div>

      <Section icon={Receipt} title={isVendor ? "Purchase Bills" : "Sales Bills"} count={invoices.length} hideWhenEmpty>
        <Table head={["Number", "Amount", "Date", "Due", "Status"]} rows={invoices.map((inv) => (
          <tr key={inv.id} data-testid={`profile-invoice-${inv.id}`} className="border-t border-border">
            <td className="px-3 py-2 font-mono">{inv.number || "—"}</td>
            <td className="px-3 py-2 font-semibold">{money(inv.amount, inv.currency)}</td>
            <td className="px-3 py-2 font-mono text-xs">{inv.date || "—"}</td>
            <td className="px-3 py-2 font-mono text-xs">{inv.due_date || "—"}</td>
            <td className="px-3 py-2"><Chip value={inv.status} /></td>
          </tr>
        ))} />
      </Section>

      <Section icon={CurrencyCircleDollar} title="Payments" count={payments.length} hideWhenEmpty>
        <Table head={["Direction", "Amount", "Method", "Reference", "Date"]} rows={payments.map((p) => (
          <tr key={p.id} data-testid={`profile-payment-${p.id}`} className="border-t border-border">
            <td className="px-3 py-2"><Chip value={p.direction === "in" ? "received" : "paid"} className={p.direction === "in" ? "bg-success-50 text-success-800" : "bg-muted text-muted-foreground"} /></td>
            <td className="px-3 py-2 font-semibold">{money(p.amount, p.currency)}</td>
            <td className="px-3 py-2">{p.method || "—"}</td>
            <td className="px-3 py-2 font-mono text-xs">{p.reference || "—"}</td>
            <td className="px-3 py-2 font-mono text-xs">{p.date || "—"}</td>
          </tr>
        ))} />
      </Section>

      {isVendor && (
        <Section icon={Truck} title="Pending Deliveries" count={pending_deliveries.length} hideWhenEmpty>
          <div className="space-y-2">{pending_deliveries.map((w) => (
            <div key={w.id} className="border border-border bg-white p-3 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{w.title}</span><Chip value={w.stage} />
            </div>
          ))}</div>
        </Section>
      )}

      {isVendor && price_history.length > 0 && (
        <Section icon={TrendUp} title="Price History" count={price_history.length}>
          <Table head={["Item", "Rate", "Date"]} rows={price_history.map((h, i) => (
            <tr key={`${h.item || "row"}-${h.date || ""}-${i}`} className="border-t border-border">
              <td className="px-3 py-2">{h.item}</td>
              <td className="px-3 py-2 font-semibold">{money(h.rate, cur)}</td>
              <td className="px-3 py-2 font-mono text-xs">{h.date || "—"}</td>
            </tr>
          ))} />
        </Section>
      )}

      <Section icon={CheckSquare} title="Follow-ups & Tasks" count={follow_ups.length} hideWhenEmpty>
        <div className="space-y-2">{follow_ups.map((t) => (
          <div key={t.id} className="border border-border bg-white p-3 flex items-center justify-between gap-2">
            <span className="text-sm">{t.title}</span>
            <div className="flex gap-1.5">{t.assignee_role && <Chip value={t.assignee_role} className="bg-white" />}<Chip value={t.status} /></div>
          </div>
        ))}</div>
      </Section>

      <Section icon={Warning} title="Complaints" count={complaints.length} hideWhenEmpty>
        <div className="space-y-2">{complaints.map((cp) => (
          <div key={cp.id} data-testid={`profile-complaint-${cp.id}`} className="border border-border bg-white p-3">
            <div className="flex items-center gap-2 mb-1"><Chip value={cp.severity} /><Chip value={cp.status} /></div>
            <p className="text-sm">{cp.text}</p>
          </div>
        ))}</div>
      </Section>

      <Section icon={Brain} title="Linked Decisions" count={decisions.length} hideWhenEmpty>
        <div className="space-y-2">{decisions.map((d) => (
          <div key={d.id} className="border border-border bg-white p-3">
            <div className="flex items-center gap-2 mb-1"><Chip value={d.status} />{d.dtype && <Chip value={d.dtype} className="bg-brand-blue text-white" />}</div>
            <p className="text-sm font-semibold">{d.title}</p>
            {d.summary && <p className="text-xs text-muted-foreground">{d.summary}</p>}
          </div>
        ))}</div>
      </Section>
    </div>
  );
}
