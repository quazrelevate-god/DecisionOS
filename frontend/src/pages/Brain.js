import { useState } from "react";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { MagnifyingGlass } from "@phosphor-icons/react";

export default function Brain() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);

  const search = async (e) => {
    e?.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.get(`/brain/search?q=${encodeURIComponent(q)}`);
      setRes(data);
    } finally {
      setLoading(false);
    }
  };

  const total = res ? res.decisions.length + res.tasks.length + res.workflows.length + (res.contacts?.length || 0) : 0;

  return (
    <div>
      <PageHeader eyebrow="Linked operational memory" title="Company Brain" />

      <form onSubmit={search} className="flex gap-2 mb-8 max-w-2xl">
        <div className="flex-1 flex items-center border border-black bg-white px-4">
          <MagnifyingGlass size={18} weight="bold" className="text-muted-foreground" />
          <input
            data-testid="brain-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search decisions, tasks, workflows…"
            className="flex-1 py-3 px-3 text-sm font-mono focus:outline-none"
          />
        </div>
        <button data-testid="brain-search-button" className="bg-brand-red text-white px-6 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          Search
        </button>
      </form>

      {loading && <p className="font-mono text-sm">Searching…</p>}
      {!res && !loading && <EmptyState title="Search the company brain" hint="Trace any founder decision to the tasks and workflows it created." />}
      {res && !loading && (
        <>
          <p className="label-mono text-muted-foreground mb-6">{total} linked record(s)</p>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
            {/* Decisions */}
            <section>
              <h3 className="font-heading font-extrabold uppercase tracking-tight text-lg mb-3">Decisions ({res.decisions.length})</h3>
              <div className="space-y-3">
                {res.decisions.map((d) => (
                  <div key={d.id} data-testid={`brain-decision-${d.id}`} className="card-brutal p-4">
                    <div className="flex items-center justify-between mb-2"><Chip value="decision" className="bg-brand-blue text-white" /><Chip value={d.status} /></div>
                    <p className="font-semibold text-sm">{d.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{d.summary}</p>
                    {d.tasks?.length > 0 && (
                      <div className="mt-3 border-t border-black/10 pt-2">
                        <p className="label-mono text-muted-foreground mb-1">Linked tasks</p>
                        {d.tasks.map((t) => <p key={t.id} className="text-xs">→ {t.title}</p>)}
                      </div>
                    )}
                  </div>
                ))}
                {res.decisions.length === 0 && <p className="text-xs text-muted-foreground">No matches</p>}
              </div>
            </section>
            {/* Tasks */}
            <section>
              <h3 className="font-heading font-extrabold uppercase tracking-tight text-lg mb-3">Tasks ({res.tasks.length})</h3>
              <div className="space-y-3">
                {res.tasks.map((t) => (
                  <div key={t.id} data-testid={`brain-task-${t.id}`} className="card-brutal p-4">
                    <div className="flex items-center justify-between mb-2"><Chip value={t.status} />{t.assignee_role && <Chip value={t.assignee_role} className="bg-white" />}</div>
                    <p className="font-semibold text-sm">{t.title}</p>
                    {t.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
                  </div>
                ))}
                {res.tasks.length === 0 && <p className="text-xs text-muted-foreground">No matches</p>}
              </div>
            </section>
            {/* Workflows */}
            <section>
              <h3 className="font-heading font-extrabold uppercase tracking-tight text-lg mb-3">Workflows ({res.workflows.length})</h3>
              <div className="space-y-3">
                {res.workflows.map((w) => (
                  <div key={w.id} data-testid={`brain-workflow-${w.id}`} className="card-brutal p-4">
                    <div className="flex items-center justify-between mb-2"><Chip value={w.type} className="bg-brand-yellow text-black" /><Chip value={w.stage} /></div>
                    <p className="font-semibold text-sm">{w.title}</p>
                    {w.counterparty && <p className="text-xs text-muted-foreground mt-1">{w.counterparty}</p>}
                  </div>
                ))}
                {res.workflows.length === 0 && <p className="text-xs text-muted-foreground">No matches</p>}
              </div>
            </section>
            {/* Contacts */}
            <section>
              <h3 className="font-heading font-extrabold uppercase tracking-tight text-lg mb-3">Contacts ({res.contacts?.length || 0})</h3>
              <div className="space-y-3">
                {(res.contacts || []).map((c) => (
                  <div key={c.id} data-testid={`brain-contact-${c.id}`} className="card-brutal p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Chip value={c.type} className={c.type === "customer" ? "bg-brand-blue text-white" : "bg-brand-yellow text-black"} />
                      <Chip value={c.status} />
                    </div>
                    <p className="font-semibold text-sm">{c.name}</p>
                    {c.company && <p className="text-xs text-muted-foreground mt-1">{c.company}</p>}
                    {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                  </div>
                ))}
                {(res.contacts || []).length === 0 && <p className="text-xs text-muted-foreground">No matches</p>}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
