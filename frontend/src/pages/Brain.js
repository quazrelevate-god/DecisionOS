import { useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { MagnifyingGlass, ChatCircleText, Lock, Books, Sparkle, Spinner } from "@phosphor-icons/react";
import { AskPanel } from "./AskAI";
import { DocumentsPanel } from "./BrainDocuments";
import { MicDictateButton } from "../components/MicDictateButton";
// Epic 2 Sprint 5 (E2-33): capture bar moves here from Desk. Single AI home.
import { DexCaptureBar } from "../components/DexCaptureBar";
import { useIsMobile } from "../hooks/useIsMobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
        <div className="flex-1 flex items-center border border-border bg-white px-4">
          <MagnifyingGlass size={18} weight="bold" className="text-muted-foreground" />
          <input
            data-testid="brain-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("brain.search_ph")}
            className="flex-1 py-3 px-3 text-sm font-mono focus:outline-none"
          />
        </div>
        <MicDictateButton className="px-4" title={t("brain.speak_search")} onText={(txt) => setQ((v) => (v ? `${v} ${txt}` : txt))} />
        <button data-testid="brain-search-button" className="bg-brand-600 text-white px-6 text-sm font-medium border border-border transition-all">
          {t("brain.search_btn")}
        </button>
      </form>
      <p className="text-xs text-muted-foreground mb-6">{t("brain.search_hint")}</p>

      {loading && <p className="font-mono text-sm">{t("brain.searching")}</p>}
      {!res && !loading && <EmptyState title={t("brain.empty_title")} hint={t("brain.empty_hint")} />}
      {res && !loading && (
        <>
          <p className="label-mono text-muted-foreground mb-6">{t("brain.linked", { count: total })}</p>
          {res.scope && res.scope.finance_visible === false && (
            <div data-testid="brain-finance-restricted" className="mb-6 flex items-center gap-2 text-xs border-l-2 border-brand-600 bg-brand-600/5 px-3 py-2 rounded">
              <Lock size={14} weight="bold" className="text-brand-600 shrink-0" />
              <span>Financial records (invoices, expenses, assets, inventory &amp; amounts) are restricted to Owner and Finance roles.</span>
            </div>
          )}
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
            {/* Decisions */}
            <section>
              <h3 className="font-medium text-lg mb-3">{t("brain.decisions")} ({res.decisions.length})</h3>
              <div className="space-y-3">
                {res.decisions.map((d) => (
                  <div key={d.id} data-testid={`brain-decision-${d.id}`} className="card-brutal p-4">
                    <div className="flex items-center justify-between mb-2"><Chip value="decision" className="bg-primary text-primary-foreground" /><Chip value={d.status} /></div>
                    <p className="font-semibold text-sm">{d.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{d.summary}</p>
                    {d.tasks?.length > 0 && (
                      <div className="mt-3 border-t border-border pt-2">
                        <p className="label-mono text-muted-foreground mb-1">{t("brain.linked_tasks")}</p>
                        {d.tasks.map((tk) => <p key={tk.id} className="text-xs">→ {tk.title}</p>)}
                      </div>
                    )}
                  </div>
                ))}
                {res.decisions.length === 0 && <p className="text-xs text-muted-foreground">{t("brain.no_matches")}</p>}
              </div>
            </section>
            {/* Tasks */}
            <section>
              <h3 className="font-medium text-lg mb-3">{t("brain.tasks")} ({res.tasks.length})</h3>
              <div className="space-y-3">
                {res.tasks.map((tk) => (
                  <div key={tk.id} data-testid={`brain-task-${tk.id}`} className="card-brutal p-4">
                    <div className="flex items-center justify-between mb-2"><Chip value={tk.status} />{tk.assignee_role && <Chip value={tk.assignee_role} className="bg-white" />}</div>
                    <p className="font-semibold text-sm">{tk.title}</p>
                    {tk.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tk.description}</p>}
                  </div>
                ))}
                {res.tasks.length === 0 && <p className="text-xs text-muted-foreground">{t("brain.no_matches")}</p>}
              </div>
            </section>
            {/* Workflows */}
            <section>
              <h3 className="font-medium text-lg mb-3">{t("brain.workflows")} ({res.workflows.length})</h3>
              <div className="space-y-3">
                {res.workflows.map((w) => (
                  <div key={w.id} data-testid={`brain-workflow-${w.id}`} className="card-brutal p-4">
                    <div className="flex items-center justify-between mb-2"><Chip value={w.type} className="bg-caution-50 text-caution-800" /><Chip value={w.stage} /></div>
                    <p className="font-semibold text-sm">{w.title}</p>
                    {w.counterparty && <p className="text-xs text-muted-foreground mt-1">{w.counterparty}</p>}
                  </div>
                ))}
                {res.workflows.length === 0 && <p className="text-xs text-muted-foreground">{t("brain.no_matches")}</p>}
              </div>
            </section>
            {/* Contacts */}
            <section>
              <h3 className="font-medium text-lg mb-3">{t("brain.contacts")} ({res.contacts?.length || 0})</h3>
              <div className="space-y-3">
                {(res.contacts || []).map((c) => (
                  <div key={c.id} data-testid={`brain-contact-${c.id}`} className="card-brutal p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Chip value={c.type} className={c.type === "customer" ? "bg-primary text-primary-foreground" : "bg-caution-50 text-caution-800"} />
                      <Chip value={c.status} />
                    </div>
                    <p className="font-semibold text-sm">{c.name}</p>
                    {c.company && <p className="text-xs text-muted-foreground mt-1">{c.company}</p>}
                    {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                  </div>
                ))}
                {(res.contacts || []).length === 0 && <p className="text-xs text-muted-foreground">{t("brain.no_matches")}</p>}
              </div>
            </section>
          </div>
          {(res.memory || []).length > 0 && (
            <div className="mt-6">
              <h3 className="font-medium text-lg mb-3">{t("brain.memory")} ({res.memory.length})</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {res.memory.map((m) => (
                  <div key={m.id} data-testid={`brain-memory-${m.id}`} className="card-brutal p-4 border-l-4 border-l-brand-600">
                    <p className="text-sm">{m.text}</p>
                    <Chip value={m.tag} className="mt-2 bg-primary text-primary-foreground" />
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
  const qc = useQueryClient();
  const [tab, setTab] = useState("ask");
  // MPWA-11: mobile gets a wrapping pill tab strip and a thumb-sized capture
  // bar. Desktop renders unchanged below.
  const isMobile = useIsMobile();
  const TABS = [
    { key: "ask", label: t("brain.ask"), icon: ChatCircleText },
    { key: "search", label: t("brain.search"), icon: MagnifyingGlass },
    { key: "documents", label: "Documents", icon: Books },
  ];

  // Epic 2 Sprint 5 (E2-35): poll for captures Dex is still structuring.
  // Backend counts capture_drafts with status in {processing/queued/
  // structuring} scoped to this user. When > 0, render a small badge
  // under the tabs so the founder sees 'did my capture go through?'
  // answered with 'Dex is structuring N right now'. Refetch every 8s
  // so the badge disappears within ~8s of the AI finishing.
  //
  // MPWA-13 (merge): this sat BELOW the mobile early return, which made it a
  // conditional hook — the hook count differed between a phone and a desktop
  // render of the same component, and React would have thrown on any viewport
  // change. Both branches need the count anyway.
  const { data: inflight } = useQuery({
    queryKey: ["dex-inflight-count"],
    queryFn: () => api.get("/dex/inflight-count").then((r) => r.data),
    refetchInterval: 8000,
  });
  const inflightN = inflight?.count || 0;

  if (isMobile) {
    return (
      <div data-testid="brain-mobile">
        {/* Keep the Dex name — §8: never surface "Brain" or "Company Brain"
            in mobile copy, even though the route stays /brain. */}
        <h1 className="font-heading text-2xl font-bold tracking-tight">{t("brain.title")}</h1>
        <p className="mt-1 text-[0.9375rem] text-muted-foreground">{t("brain.tabs_hint")}</p>

        {/* The desktop strip is three uppercase buttons in a `w-fit` row, which
            overflowed 390px. Pills that wrap, sentence case, no mono. */}
        <div className="mt-3 flex flex-wrap gap-touch-gap" data-testid="brain-tabs">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              data-testid={`brain-tab-${tb.key}`}
              aria-pressed={tab === tb.key}
              className={`flex items-center gap-1.5 rounded-pill border px-3.5 text-sm font-semibold transition-colors ${
                tab === tb.key
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent"
              }`}
              style={{ minHeight: "var(--control-h-sm)" }}
            >
              <tb.icon size={18} weight={tab === tb.key ? "fill" : "regular"} aria-hidden="true" />
              {tb.label}
            </button>
          ))}
        </div>

        {/* size="lg": mic 56px, input 48px, Send on its own row so it is never
            clipped at the right edge (§8 MPWA-11). */}
        <div className="mt-4">
          <DexCaptureBar
            size="lg"
            onCaptured={() => qc.invalidateQueries({ queryKey: ["voice-notes"] })}
          />
        </div>

        <div className="mt-4">
          {tab === "ask" ? <AskPanel /> : tab === "search" ? <SearchPanel /> : <DocumentsPanel />}
        </div>
      </div>
    );
  }

  // Epic 2 Sprint 5 (E2-32): 'Company Brain' becomes 'Dex' -- single AI
  // persona. Founder ask 2026-08-14. Route stays /brain for bookmark
  // safety; /dex is an alias set up in App.js.

  return (
    <div>
      <PageHeader eyebrow={t("brain.eyebrow")} title={t("brain.title")}>
        <div className="flex flex-col gap-1" data-testid="brain-tabs-wrap">
          <div className="flex border border-border w-fit" data-testid="brain-tabs">
            <button onClick={() => setTab("ask")} data-testid="brain-tab-ask"
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-r border-border transition-colors ${tab === "ask" ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}>
              <ChatCircleText size={16} weight="bold" /> {t("brain.ask")}
            </button>
            <button onClick={() => setTab("search")} data-testid="brain-tab-search"
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-r border-border transition-colors ${tab === "search" ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}>
              <MagnifyingGlass size={16} weight="bold" /> {t("brain.search")}
            </button>
            <button onClick={() => setTab("documents")} data-testid="brain-tab-documents"
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${tab === "documents" ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}>
              <Books size={16} weight="bold" /> Documents
            </button>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="brain-tabs-hint">{t("brain.tabs_hint")}</p>
        </div>
      </PageHeader>

      {/* Epic 2 Sprint 5 (E2-33): capture bar migrated from Desk. Always-visible
          at the top of Dex so speak/type/upload is one click from every sub-tab. */}
      <DexCaptureBar onCaptured={() => {
        qc.invalidateQueries({ queryKey: ["voice-notes"] });
        // E2-35: bump the in-flight badge immediately, don't wait for the
        // 8s poll to catch up.
        qc.invalidateQueries({ queryKey: ["dex-inflight-count"] });
      }} />

      {/* E2-35: in-flight badge. Only renders while Dex is actively
          structuring at least one capture. Kills 'did my capture go
          through?' anxiety. */}
      {inflightN > 0 && (
        <div
          data-testid="dex-inflight-badge"
          className="mb-4 inline-flex items-center gap-2 border border-border bg-caution-50 px-3 py-1.5 shadow-sm"
        >
          <Spinner size={14} weight="bold" className="animate-spin text-brand-ink" />
          <Sparkle size={12} weight="fill" className="text-brand-600" />
          <span className="text-xs font-medium text-brand-ink">
            Dex is structuring {inflightN} capture{inflightN === 1 ? "" : "s"} right now
          </span>
        </div>
      )}

      {tab === "ask" ? <AskPanel /> : tab === "search" ? <SearchPanel /> : <DocumentsPanel />}
    </div>
  );
}
