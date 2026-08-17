// MPWA-10 · /contacts/:id — mobile.
//
// Full-screen detail with an in-app back path, because iOS standalone has no
// browser back button (§8 MPWA-02).
//
// Sections are accordions in §8's priority order — header, financial summary,
// workflow feed, activity timeline, AI relationship intelligence, documents,
// tasks, complaints — and only the first two are expanded. That order is the
// point: what he owes / is owed comes before anything the AI has to say.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, CaretDown, Phone, EnvelopeSimple, CurrencyInr, ArrowRight,
  ClockCounterClockwise, Sparkle, FileText, ListChecks, Warning, MapPin,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { inr } from "../../lib/format";
import { EmptyState, ListSkeleton, MoneySkeleton, StatusChip, dueLabel } from "../../components/mobile";

// §5.4: relative inside 7 days, absolute beyond, and never a raw ISO string —
// "due 2026-07-14" is a database value wearing a date's clothes.
const humanDate = (iso) => dueLabel(iso)?.text || null;

function Accordion({ id, title, icon: Icon, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-border bg-card" data-testid={`cp-section-${id}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid={`cp-toggle-${id}`}
        className="flex w-full items-center gap-2.5 px-3.5 text-left transition-colors hover:bg-accent"
        style={{ minHeight: "var(--control-h-md)" }}
      >
        <Icon size={20} weight="regular" aria-hidden="true" className="shrink-0 text-neutral-500" />
        <span className="min-w-0 flex-1 font-heading text-[0.9375rem] font-semibold tracking-tight">
          {title}
          {count != null && count > 0 && (
            <span className="ml-1.5 text-[length:var(--text-label)] font-bold leading-4 text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </span>
        <CaretDown
          size={20}
          weight="bold"
          aria-hidden="true"
          className={`shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="border-t border-border p-3.5">{children}</div>}
    </section>
  );
}

const Row = ({ label, value }) => (
  <p className="flex items-baseline justify-between gap-3 py-1 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-semibold tabular-nums">{value}</span>
  </p>
);

// Was imported from the mobile My Work page, which is gone — /my-work renders
// the desktop tree on every viewport now. Three pure lines; re-homed rather
// than kept alive in a deleted module.
function humanStage(s) {
  if (!s) return "";
  return String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default function ContactProfileMobile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["contact-profile", id],
    queryFn: () => api.get(`/contacts/${id}/profile`).then((r) => r.data),
  });

  if (isLoading) {
    return (
      <div data-testid="contact-profile-mobile">
        <BackBar onBack={() => navigate("/crm")} />
        <div className="mt-3"><ListSkeleton rows={3} /></div>
      </div>
    );
  }
  if (error || !data?.contact) {
    return (
      <div data-testid="contact-profile-mobile">
        <BackBar onBack={() => navigate("/crm")} />
        <div className="mt-3">
          <EmptyState
            icon={Warning}
            title="This contact isn't available."
            hint="It may have been removed, or you may not have access."
            actionLabel="Back to people"
            onAction={() => navigate("/crm")}
          />
        </div>
      </div>
    );
  }

  const {
    contact: c, summary = {}, invoices = [], payments = [], complaints = [],
    workflows = [], pending_deliveries = [], follow_ups = [], price_history = [],
    ai_relationship: rel, documents = [], tasks = [],
  } = data;

  const outstanding = summary.outstanding ?? null;
  const billed = summary.total_billed ?? null;
  const paid = summary.total_paid ?? null;

  return (
    <div data-testid="contact-profile-mobile">
      <BackBar onBack={() => navigate("/crm")} />

      {/* ---------------- header (always visible) ---------------- */}
      <header className="mt-3" data-testid="cp-header">
        <h1 className="font-heading text-2xl font-bold leading-tight tracking-tight">{c.name}</h1>
        {c.company && c.company !== c.name && (
          <p className="mt-0.5 text-[0.9375rem] text-muted-foreground">{c.company}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-touch-gap">
          <StatusChip
            status={c.status === "inactive" ? "rejected" : "completed"}
            label={c.status === "inactive" ? "Dormant" : "Active"}
          />
          {c.lifecycle_stage && (
            // NOT `directive` (brand-tinted): §3.1 gives brand exactly one job,
            // "the action to take", and never a status or a category. A
            // lifecycle stage is a category, so it takes caution when it means
            // trouble and neutral otherwise.
            <StatusChip
              status={/risk|dormant|watch/i.test(c.lifecycle_stage) ? "pending" : "rejected"}
              label={humanStage(c.lifecycle_stage)}
            />
          )}
        </div>
        {/* One tap each — call and email are the two things he actually does. */}
        <div className="mt-3 flex flex-wrap gap-touch-gap">
          {c.phone && (
            <a
              href={`tel:${c.phone}`}
              data-testid="cp-call"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground"
              style={{ minHeight: "var(--control-h-md)" }}
            >
              <Phone size={20} weight="bold" /> Call
            </a>
          )}
          {c.email && (
            <a
              href={`mailto:${c.email}`}
              data-testid="cp-email"
              className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 text-base font-semibold"
              style={{ minHeight: "var(--control-h-md)" }}
            >
              <EnvelopeSimple size={20} weight="bold" /> Email
            </a>
          )}
        </div>
        {(c.city || c.address) && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin size={16} weight="bold" aria-hidden="true" />
            {c.address || c.city}
          </p>
        )}
      </header>

      {/* ---------------- financial summary (expanded) ---------------- */}
      <Accordion id="financial" title="Money" icon={CurrencyInr} defaultOpen>
        {/* §5.3: a skeleton, never a zero standing in for an unknown. */}
        <Row label="Outstanding" value={outstanding == null ? <MoneySkeleton /> : inr(outstanding)} />
        <Row label="Billed to date" value={billed == null ? <MoneySkeleton /> : inr(billed)} />
        <Row label="Paid to date" value={paid == null ? <MoneySkeleton /> : inr(paid)} />
        {summary.open_complaints > 0 && (
          <Row label="Open complaints" value={summary.open_complaints} />
        )}
        {invoices.length > 0 && (
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {invoices.slice(0, 5).map((iv) => (
              <li key={iv.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{iv.number || "Invoice"}</span>
                  <span className="block text-[length:var(--text-label)] leading-4 text-muted-foreground">
                    {humanStage(iv.status)}{humanDate(iv.due_date) ? ` · ${humanDate(iv.due_date)}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {inr(Math.max(0, (iv.amount || 0) - (iv.paid_amount || 0)))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Accordion>

      {/* ---------------- workflow feed ---------------- */}
      <Accordion id="workflows" title="In progress" icon={ArrowRight} count={workflows.length + pending_deliveries.length}>
        {workflows.length === 0 && pending_deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing running with them right now.</p>
        ) : (
          <ul className="space-y-2">
            {workflows.map((w) => (
              <li key={w.id} className="text-sm">
                <span className="font-semibold">{w.title || "Workflow"}</span>
                <span className="block text-muted-foreground">{humanStage(w.stage)}</span>
              </li>
            ))}
            {pending_deliveries.map((d) => (
              <li key={d.id} className="text-sm">
                <span className="font-semibold">{d.title}</span>
                <span className="block text-muted-foreground">
                  {humanDate(d.due_date) || `Due ${d.due_date}`}
                  {d.amount ? ` · ${inr(d.amount)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Accordion>

      {/* ---------------- activity timeline ---------------- */}
      <Accordion id="activity" title="Recent activity" icon={ClockCounterClockwise} count={payments.length + follow_ups.length}>
        {payments.length === 0 && follow_ups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {follow_ups.map((f) => (
              <li key={f.id}>
                <span className="font-semibold">{f.title}</span>
                <span className="block text-muted-foreground">
                  {f.owner_name ? `${f.owner_name} · ` : ""}{(humanDate(f.due_date) || f.due_date).toLowerCase()}
                </span>
              </li>
            ))}
            {payments.slice(0, 5).map((p) => (
              <li key={p.id}>
                <span className="font-semibold">{inr(p.amount)} received</span>
                <span className="block text-muted-foreground">
                  {p.mode} {p.reference}{humanDate(p.date) ? ` · ${humanDate(p.date)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Accordion>

      {/* ---------------- AI relationship intelligence ---------------- */}
      {rel && (
        <Accordion id="ai" title="How this relationship is going" icon={Sparkle}>
          <div className="flex gap-3">
            <Row label="Health" value={`${rel.relationship_score ?? "—"}/100`} />
          </div>
          {rel.reason && <p className="mt-1 text-sm leading-relaxed">{rel.reason}</p>}
          {rel.signals?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {rel.signals.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-neutral-400" />
                  {s}
                </li>
              ))}
            </ul>
          )}
        </Accordion>
      )}

      {/* ---------------- documents ---------------- */}
      <Accordion id="documents" title="Documents" icon={FileText} count={documents.length}>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing filed against them.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {documents.map((d) => (
              <li key={d.id} className="truncate">{d.title || d.filename}</li>
            ))}
          </ul>
        )}
      </Accordion>

      {/* ---------------- tasks ---------------- */}
      <Accordion id="tasks" title="Tasks" icon={ListChecks} count={tasks.length}>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {tasks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/my-work?task=${t.id}`)}
                  className="w-full text-left font-semibold underline-offset-2 hover:underline"
                  style={{ minHeight: "var(--control-h-sm)" }}
                >
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Accordion>

      {/* ---------------- complaints ---------------- */}
      <Accordion id="complaints" title="Complaints" icon={Warning} count={complaints.length}>
        {complaints.length === 0 ? (
          <p className="text-sm text-muted-foreground">None raised.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {complaints.map((cp) => (
              <li key={cp.id}>
                <span className="font-semibold">{cp.title}</span>
                <span className="block text-muted-foreground">{humanStage(cp.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </Accordion>

      {price_history.length > 0 && (
        <Accordion id="prices" title="What they've paid before" icon={CurrencyInr} count={price_history.length}>
          <ul className="space-y-1 text-sm">
            {price_history.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{p.item}</span>
                <span className="shrink-0 tabular-nums">
                  {inr(p.rate)}/{p.unit}{humanDate(p.date) ? ` · ${humanDate(p.date)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Accordion>
      )}
    </div>
  );
}

// In-app back: iOS standalone has no browser chrome, so without this the detail
// screen is a dead end (§8 MPWA-02).
function BackBar({ onBack }) {
  return (
    <button
      type="button"
      onClick={onBack}
      data-testid="cp-back"
      className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      style={{ minHeight: "var(--control-h-sm)" }}
    >
      <ArrowLeft size={20} weight="bold" aria-hidden="true" />
      Back to people
    </button>
  );
}
