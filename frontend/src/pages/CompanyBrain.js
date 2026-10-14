// 2026-10-06 · /company-brain — the Company Brain, its own place.
//
// Founder: "are we having the brain, company brain separately where we will
// store all the data like policies, things, so they can upload it directly to
// the brain … and with the journal it should be different from the brain".
//
// WHAT WAS THERE. Documents lived behind a small "Documents" toggle inside the
// Dex chat; company NOTES had no screen at all (the AI wrote them from
// captures, and only the owner's Journal showed them, beside decisions). The
// Journal is now decision history only.
//
// WHAT THIS IS. The company's knowledge, in two kinds:
//   · Documents — policies, SOPs, contracts, price lists, reports (files).
//   · Notes     — short facts worth remembering ("Bluewave pays 30% advance").
// Both are indexed for Dex, both carry "who can see", and only the owner and
// Manage Team add, edit or remove (founder's call); everyone reads what they may.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "../lib/api";
import { noteTag } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PageHeader, EmptyState, LoadFailed, ConfirmAction } from "../components/common";
import { GlassSelect } from "../components/neuglass/GlassSelect";
import { useIsMobile } from "../hooks/useIsMobile";
import { hintDockSlider } from "../lib/dockHint";
import { DocumentsPanel } from "./BrainDocuments";
import { ReportButton } from "../components/ReportButton";
import { Books, Note, Plus, MagnifyingGlass, PencilSimple, Trash, Lock, Sparkle, ArrowRight, ArrowLeft } from "@phosphor-icons/react";

const FIELD = "w-full rounded-2xl bg-white/80 px-3 py-2 text-sm text-slate-800 ring-1 ring-inset ring-slate-900/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25";
const INK = "inline-flex h-10 items-center gap-1.5 rounded-pill bg-ng-ink px-4 text-sm font-medium text-white disabled:opacity-50";
const QUIET = "inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-900/[0.08] hover:bg-white";

const INDEX_NOTE = {
  waiting_for_ai_consent: "Dex can't search this yet — AI is switched off for this company.",
  failed: "Dex couldn't index this note — it will retry on the next restart.",
};

function whoSees(n) {
  if (n.visibility === "dept") return `${n.department || "One team"} only`;
  if (n.visibility === "private") return "Owner & managers only";
  return "Everyone";
}

function sourceLine(n) {
  if (n.source === "capture") return "Noted by Dex from a capture";
  if (n.source === "finance") return "Finance record";
  return `Added by ${n.created_by_name || "a manager"}`;
}

function NoteForm({ initial, teams, busy, onSave, onCancel }) {
  const [text, setText] = useState(initial?.text || "");
  const [tag, setTag] = useState(initial?.tag || "note");
  const [vis, setVis] = useState(initial?.visibility || "public");
  const [team, setTeam] = useState(initial?.department || "");
  const save = () => {
    if (!text.trim()) return toast.error("Write the note first.");
    if (vis === "dept" && !team) return toast.error("Choose the team that can see it.");
    onSave({ text: text.trim(), tag, visibility: vis, department: vis === "dept" ? team : "",
             roles_allowed: vis === "dept" ? team : "" });
  };
  return (
    <div className="ng-bento space-y-3 p-4" data-testid="brain-note-form">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000}
        placeholder="Something the company should remember — e.g. Bluewave pays 30% advance, balance in 45 days."
        className={FIELD} data-testid="brain-note-text" />
      <div className="grid gap-2 sm:grid-cols-3">
        <input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} placeholder="Tag (e.g. customer, policy)"
          className={FIELD} data-testid="brain-note-tag" />
        {/* No native dropdowns: the app's own glass list (GlassSelect). */}
        <GlassSelect variant="field" triggerClassName={`${FIELD} h-10`} testid="brain-note-visibility" ariaLabel="Who can see this note"
          value={vis} onChange={setVis}
          options={[{ value: "public", label: "Everyone can see" }, { value: "dept", label: "One team" }, { value: "private", label: "Owner & managers only" }]} />
        {vis === "dept" && (
          <GlassSelect variant="field" triggerClassName={`${FIELD} h-10`} testid="brain-note-team" ariaLabel="Which team can see it"
            value={team} onChange={setTeam} placeholder="Choose a team…"
            options={teams.map((t) => ({ value: t.key, label: t.label }))} />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy} className={INK} data-testid="brain-note-save">
          {busy ? "Saving…" : initial ? "Save note" : "Add to Brain"}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className={QUIET}>Cancel</button>}
      </div>
    </div>
  );
}

function NotesPanel({ focusId }) {
  const { tenant, user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const teams = useMemo(() => (tenant?.roles || []).filter((r) => r?.key && r.key !== "owner")
    .map((r) => ({ key: r.key, label: r.label || r.key })), [tenant]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["brain-notes", term],
    queryFn: () => api.get(`/brain/notes?q=${encodeURIComponent(term)}`).then((r) => r.data),
  });
  const notes = data?.notes || [];
  const canManage = !!data?.can_manage;

  useEffect(() => {
    if (!focusId || isLoading) return;
    document.querySelector(`[data-testid="brain-note-${focusId}"]`)?.scrollIntoView({ block: "center" });
  }, [focusId, isLoading, notes.length]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); toast.success(ok); qc.invalidateQueries({ queryKey: ["brain-notes"] }); return true; }
    catch (e) { toast.error(e?.response?.data?.detail || "That didn't save — try again."); return false; }
    finally { setBusy(false); }
  };
  const add = async (body) => { if (await run(() => api.post("/brain/notes", body), "Added to the Company Brain")) setAdding(false); };
  const update = async (id, body) => { if (await run(() => api.patch(`/brain/notes/${id}`, body), "Note saved")) setEditing(null); };
  /* Asked in the app, not by the browser: window.confirm answers false with
     nothing drawn in the Capacitor WebView (the same fault the documents had). */
  const [pendingRemove, setPendingRemove] = useState(null);
  const remove = (n) => setPendingRemove(n);
  const confirmRemove = async () => {
    const n = pendingRemove;
    if (!n) return;
    if (await run(() => api.delete(`/brain/notes/${n.id}`), "Note removed")) setPendingRemove(null);
  };

  return (
    <div className="space-y-4" data-testid="brain-notes">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <form onSubmit={(e) => { e.preventDefault(); setTerm(q); }} className="ng-pressed flex min-w-0 flex-1 items-center rounded-pill">
          <MagnifyingGlass size={16} className="ml-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes…" data-testid="brain-notes-search"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none" />
        </form>
        {canManage && !adding && (
          <button type="button" onClick={() => setAdding(true)} className={INK} data-testid="brain-note-add">
            <Plus size={14} weight="bold" /> Add a note
          </button>
        )}
      </div>

      {adding && <NoteForm teams={teams} busy={busy} onSave={add} onCancel={() => setAdding(false)} />}

      {isError ? <LoadFailed what="the notes" onRetry={refetch} /> : isLoading ? (
        <div className="space-y-2" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-20 rounded-cardlg" />)}</div>
      ) : notes.length === 0 ? (
        <EmptyState testid="brain-notes-empty" title={term ? "No notes match" : "No notes yet"}
          hint={canManage ? "Add what the company should remember: customer terms, supplier quirks, rules of thumb. Dex uses them in answers."
                          : "Your managers add the company's notes here; Dex uses them in answers."} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2" data-testid="brain-notes-list">
          {notes.map((n) => editing === n.id ? (
            <NoteForm key={n.id} initial={n} teams={teams} busy={busy}
              onSave={(body) => update(n.id, body)} onCancel={() => setEditing(null)} />
          ) : (
            <div key={n.id} data-testid={`brain-note-${n.id}`}
              className={`ng-bento flex flex-col gap-2 p-4 ${n.id === focusId ? "ring-2 ring-brand-600" : ""}`}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{n.text}</p>
              {INDEX_NOTE[n.index_state] && <p className="text-[11px] text-caution-600">{INDEX_NOTE[n.index_state]}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-slate-500">
                <span className="rounded-pill bg-slate-900/[0.05] px-2 py-0.5">{noteTag(n.tag)}</span>
                <span className="inline-flex items-center gap-1">{n.visibility !== "public" && <Lock size={10} weight="bold" />}{whoSees(n)}</span>
                <span className="inline-flex items-center gap-1">{n.source === "capture" && <Sparkle size={10} weight="bold" />}{sourceLine(n)}</span>
                {n.decision_id && (
                  <Link to={`/?focus=approval:${n.decision_id}`} className="inline-flex items-center gap-0.5 font-medium text-slate-700 hover:underline">
                    Decision <ArrowRight size={10} weight="bold" />
                  </Link>
                )}
                {n.created_by !== user?.id && (
                  <ReportButton
                    kind={n.created_by ? "content" : "ai_output"}
                    targetType="note" targetId={n.id} snapshot={n.text} size={12}
                    className="ml-auto text-slate-400"
                  />
                )}
              </div>
              {canManage && (
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setEditing(n.id)} className={QUIET} data-testid={`brain-note-edit-${n.id}`}>
                    <PencilSimple size={13} /> Edit
                  </button>
                  <button type="button" onClick={() => remove(n)} disabled={busy} className={QUIET} data-testid={`brain-note-delete-${n.id}`}>
                    <Trash size={13} /> Remove
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmAction
        open={!!pendingRemove}
        onOpenChange={() => setPendingRemove(null)}
        title="Remove this note from the Company Brain?"
        description="Dex will stop using it in answers."
        confirmLabel="Remove it" busyLabel="Removing…" cancelLabel="Keep it"
        busy={busy} onConfirm={confirmRemove} testid="brain-note-delete-confirm" />
    </div>
  );
}

/* 2026-10-12 (founder) — ASK IS IN THE DOCK ON A PHONE. "Ask Dex about it" went
   to /brain, the desktop Ask page, which is the wrong place on a phone: there,
   Ask is a swipe LEFT on the bar. So the phone gets a quiet line that says so,
   and the dock's handle shows the gesture (lib/dockHint) — once when the page
   opens, and again whenever the line is tapped. */
function AskHint() {
  useEffect(() => {
    const t = setTimeout(() => hintDockSlider("ask"), 1100);
    return () => clearTimeout(t);
  }, []);
  return (
    <button type="button" onClick={() => hintDockSlider("ask")} data-testid="company-brain-ask-hint"
      className="inline-flex items-center gap-1.5 rounded-pill px-1 py-1 text-xs font-medium text-slate-600">
      <ArrowLeft size={12} weight="bold" aria-hidden="true" />
      Swipe left on the bar below to ask Dex about these
    </button>
  );
}

export default function CompanyBrain() {
  const [params, setParams] = useSearchParams();
  const focusDoc = params.get("doc");
  const focusNote = params.get("note");
  const tab = params.get("tab") === "notes" || focusNote ? "notes" : "documents";
  const setTab = (t) => setParams(t === "notes" ? { tab: "notes" } : {}, { replace: true });
  const isMobile = useIsMobile();

  return (
    <div data-testid="company-brain-page">
      <PageHeader eyebrow="What the company knows" title="Company Brain">
        {!isMobile && (
          <Link to="/brain" className={QUIET} data-testid="company-brain-ask-dex">Ask Dex about it <ArrowRight size={12} weight="bold" /></Link>
        )}
      </PageHeader>
      <p className="-mt-3 mb-2 max-w-2xl text-sm text-slate-600">
        Policies, SOPs, contracts, price lists and the notes worth remembering. Dex answers from what is here,
        and everyone sees only what they're allowed to.
      </p>
      <div className="mb-3">{isMobile && <AskHint />}</div>
      <div className="ng-pressed mb-5 flex w-fit items-center gap-1 rounded-pill p-1" role="tablist" aria-label="Company Brain">
        {[{ k: "documents", l: "Documents", I: Books }, { k: "notes", l: "Notes", I: Note }].map(({ k, l, I }) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`company-brain-tab-${k}`}
            className={`flex h-9 items-center gap-1.5 rounded-pill px-5 text-sm ${tab === k ? "ng-pop font-semibold text-foreground" : "text-foreground/60"}`}>
            <I size={15} /> {l}
          </button>
        ))}
      </div>
      {tab === "documents" ? <DocumentsPanel focusId={focusDoc} /> : <NotesPanel focusId={focusNote} />}
    </div>
  );
}
