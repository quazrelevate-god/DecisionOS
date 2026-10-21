/* Requests (2026-10-21, docs/REQUESTS_PLAN.md) — the room of its own.
 *
 * Reached from the phone's More panel and from every request notification.
 * Laid out like Leave: the title pinned on a phone with the action under it,
 * the desktop header carrying it beside. The tab lives in the address
 * (?tab=approvals|fulfil|all) so a notification can open the right list, and
 * ?request=<id> brings the one it is about into view.
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "@phosphor-icons/react";
import { PageHeader, StickyHeader } from "../components/common";
import { RequestsPanel } from "../components/requests/RequestsPanel";
import { NewRequestDialog } from "../components/requests/NewRequestDialog";
import { INK_PILL } from "../components/neuglass/glass";

const TABS = ["mine", "approvals", "fulfil", "all"];

export default function Requests() {
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "mine";
  const setTab = (t) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (t === "mine") next.delete("tab"); else next.set("tab", t);
    next.delete("request");
    return next;
  });

  const action = (
    <button type="button" onClick={() => setNewOpen(true)} data-testid="requests-new"
      className={`flex h-11 items-center gap-2 rounded-pill px-5 text-sm font-medium ${INK_PILL}`}>
      <Plus size={16} weight="bold" aria-hidden="true" /> New request
    </button>
  );

  return (
    <div data-testid="requests-page">
      <StickyHeader className="mb-3 flex flex-col gap-4 lg:hidden" data-testid="requests-mobile-header">
        <h1 className="font-display text-3xl">Requests</h1>
        <div className="flex">{action}</div>
      </StickyHeader>
      <div className="hidden lg:block">
        <PageHeader eyebrow="Ask, approve, pay" title="Requests">{action}</PageHeader>
      </div>
      <RequestsPanel tab={tab} onTabChange={setTab} highlightId={params.get("request")} />
      <NewRequestDialog open={newOpen} onOpenChange={setNewOpen}
        onCreated={() => { if (tab !== "mine") setTab("mine"); }} />
    </div>
  );
}
