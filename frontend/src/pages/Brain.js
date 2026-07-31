import { useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { MagnifyingGlass, ChatCircleText, Lock } from "@phosphor-icons/react";
import { AskPanel } from "./AskAI";
import { MicDictateButton } from "../components/MicDictateButton";

function SearchPanel() {
  const { t } = useTranslation();
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
      <form onSubmit={search} className="flex gap-2 mb-2 max-w-2xl">
        <div className="flex-1 flex items-center border border-hairline bg-surface px-4 rounded-md">
          <MagnifyingGlass size={18} weight="bold" className="text-text-secondary" />
          <input
            data-testid="brain-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("brain.search_ph")}
            className="flex-1 py-3 px-3 text-sm text-label focus:outline-none"
          />
        </div>
        <MicDictateButton className="px-4" title={t("brain.speak_search")} onText={(txt) => setQ((v) => (v ? `${v} ${txt}` : txt))} />
        <button data-testid="brain-search-button" className="bg-primary text-primary-foreground px-6 text-sm font-semibold border border-hairline hover:shadow-sm transition-all rounded-md">
          {t("brain.search_btn")}
        </button>
      </form>
      <p className="text-xs text-text-secondary mb-8">{t("brain.search_hint")}</p>

      {loading && <p className="text-label text-sm">{t("brain.searching")}</p>}
      {!res && !loading && <EmptyState title={t("brain.empty_title")} hint={t("brain.empty_hint")} />}
      {res && !loading && (
        <>
          <p className="text-label text-text-secondary mb-6">{t("brain.linked", { count: total })}</p>
          {res.scope && res.scope.finance_visible === false && (
            <div data-testid="brain-finance-restricted" className="mb-6 flex items-center gap-2 text-xs border-l-2 border-hairline-strong bg-primary-tint px-3 py-2 rounded-md">
              <Lock size={14} weight="bold" className="text-primary-text shrink-0" />
              <span>Financial records (invoices, expenses, assets, inventory &amp; amounts) are restricted to Owner and Finance roles.</span>
            </div>
          )}
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
            {/* Decisions */}
            <section>
              <h3 className="font-extrabold tracking-tight text-lg mb-3">{t("brain.decisions")} ({res.decisions.length})</h3>
              <div className="space-y-3">
                {res.decisions.map((d) => (
                  <div key={d.id} data-testid={`brain-decision-${d.id}`} className="rounded-lg border border-hairline bg-surface p-4">
                    <div className="flex items-center justify-between mb-2"><Chip value="decision" /><Chip value={d.status} /></div>
                    <p className="font-semibold text-sm">{d.title}</p>
                    <p className="text-xs text-text-secondary mt-1 line-clamp-3">{d.summary}</p>
                    {d.tasks?.length > 0 && (
                      <div className="mt-3 border-t-hairline pt-2">
                        <p className="text-label text-text-secondary mb-1">{t("brain.linked_tasks")}</p>
                        {d.tasks.map((tk) => <p key={tk.id} className="text-xs">→ {tk.title}</p>)}
                      </div>
                    )}
                  </div>
                ))}
                {res.decisions.length === 0 && <p className="text-xs text-text-secondary">{t("brain.no_matches")}</p>}
              </div>
            </section>
            {/* Tasks */}
            <section>
              <h3 className="font-extrabold tracking-tight text-lg mb-3">{t("brain.tasks")} ({res.tasks.length})</h3>
              <div className="space-y-3">
                {res.tasks.map((tk) => (
                  <div key={tk.id} data-testid={`brain-task-${tk.id}`} className="rounded-lg border border-hairline bg-surface p-4">
                    <div className="flex items-center justify-between mb-2"><Chip value={tk.status} />{tk.assignee_role && <Chip value={tk.assignee_role} />}</div>
                    <p className="font-semibold text-sm">{tk.title}</p>
                    {tk.description && <p className="text-xs text-text-secondary mt-1 line-clamp-2">{tk.description}</p>}
                  </div>
                ))}
                {res.tasks.length === 0 && <p className="text-xs text-text-secondary">{t("brain.no_matches")}</p>}
              </div>
            </section>
            {/* Workflows */}
            <section>
              <h3 className="font-extrabold tracking-tight text-lg mb-3">{t("brain.workflows")} ({res.workflows.length})</h3>
              <div className="space-y-3">
                {res.workflows.map((w) => (
                  <div key={w.id} data-testid={`brain-workflow-${w.id}`} className="rounded-lg border border-hairline bg-surface p-4">
                    <div className="flex items-center justify-between mb-2"><Chip value={w.type} className="text-text" /><Chip value={w.stage} /></div>
                    <p className="font-semibold text-sm">{w.title}</p>
                    {w.counterparty && <p className="text-xs text-text-secondary mt-1">{w.counterparty}</p>}
                  </div>
                ))}
                {res.workflows.length === 0 && <p className="text-xs text-text-secondary">{t("brain.no_matches")}</p>}
              </div>
            </section>
            {/* Contacts */}
            <section>
              <h3 className="font-extrabold tracking-tight text-lg mb-3">{t("brain.contacts")} ({res.contacts?.length || 0})</h3>
              <div className="space-y-3">
                {(res.contacts || []).map((c) => (
                  <div key={c.id} data-testid={`brain-contact-${c.id}`} className="rounded-lg border border-hairline bg-surface p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Chip value={c.type} className={c.type === "customer" ? "bg-primary text-primary-foreground" : "bg-status-pending-bg text-text"} />
                      <Chip value={c.status} />
                    </div>
                    <p className="font-semibold text-sm">{c.name}</p>
                    {c.company && <p className="text-xs text-text-secondary mt-1">{c.company}</p>}
                    {c.phone && <p className="text-xs text-text-secondary">{c.phone}</p>}
                  </div>
                ))}
                {(res.contacts || []).length === 0 && <p className="text-xs text-text-secondary">{t("brain.no_matches")}</p>}
              </div>
            </section>
          </div>
          {(res.memory || []).length > 0 && (
            <div className="mt-8">
              <h3 className="font-extrabold tracking-tight text-lg mb-3">{t("brain.memory")} ({res.memory.length})</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {res.memory.map((m) => (
                  <div key={m.id} data-testid={`brain-memory-${m.id}`} className="rounded-lg border border-hairline bg-surface p-4 border-l-4 border-l-urgency-overdue">
                    <p className="text-sm">{m.text}</p>
                    <Chip value={m.tag} className="mt-2" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}


export default function Brain() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("ask");
  return (
    <div>
      <PageHeader eyebrow={t("brain.eyebrow")} title={t("brain.title")}>
        <div className="flex flex-col gap-1" data-testid="brain-tabs-wrap">
          <div className="flex border border-hairline w-fit rounded-md" data-testid="brain-tabs">
            <button onClick={() => setTab("ask")} data-testid="brain-tab-ask"
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold  border-r-hairline transition-colors ${tab === "ask" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>
              <ChatCircleText size={16} weight="bold" /> {t("brain.ask")}
            </button>
            <button onClick={() => setTab("search")} data-testid="brain-tab-search"
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold  transition-colors ${tab === "search" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>
              <MagnifyingGlass size={16} weight="bold" /> {t("brain.search")}
            </button>
          </div>
          <p className="text-xs text-text-secondary" data-testid="brain-tabs-hint">{t("brain.tabs_hint")}</p>
        </div>
      </PageHeader>

      {tab === "ask" ? <AskPanel /> : <SearchPanel />}
    </div>
  );
}
