import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload, MagnifyingGlass, File, Trash, DownloadSimple, Lock, Paperclip, FileText,
} from "@phosphor-icons/react";
import api, { formatApiError } from "../lib/api";
import { downloadFrom } from "../lib/native/files";
import { EmptyState, Loader, ConfirmAction } from "../components/common";
import { useAuth } from "../context/AuthContext";
import { ReportButton } from "../components/ReportButton";
import { Dialog, DialogContent } from "../components/ui/dialog";
import { GlassSelect } from "../components/neuglass/GlassSelect";
import { GLASS_PILL, INK_PILL } from "../components/neuglass/glass";
import { AREA, FIELD, Field, SHEET_CONTENT, SheetFoot, SheetHead } from "./finance/financeKit";
import { cn } from "@/lib/utils";

const KINDS = [
  { key: "policy", label: "Policy" },
  { key: "filing", label: "Filing" },
  { key: "contract", label: "Contract" },
  { key: "sop", label: "SOP" },
  { key: "report", label: "Report" },
  { key: "note", label: "Note" },
  { key: "other", label: "Other" },
];
const VISIBILITIES = [
  { key: "public", label: "Everyone in this workspace" },
  { key: "dept", label: "One department only" },
  { key: "private", label: "Only owner + named roles" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label]));

const fmtSize = (n) => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const fmtDate = (iso) => {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso.slice(0, 10); }
};

// -----------------------------------------------------------------------------
// Upload dialog — owner + team_manage only
// 2026-10-12 (founder) — the app's own sheet now (financeKit's, the same one
// Finance uses), with glass dropdowns; it was the pre-redesign square card
// with a blue button and the operating system's own select lists.
// -----------------------------------------------------------------------------
function UploadDialog({ onClose, onUploaded }) {
  const uid = useId();
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("policy");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [department, setDepartment] = useState("");
  const [rolesAllowed, setRolesAllowed] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file) { toast.error("Pick a file first"); return; }
    if (busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title || file.name);
      fd.append("kind", kind);
      fd.append("tags", tags);
      fd.append("visibility", visibility);
      if (visibility === "dept") fd.append("department", department);
      if (visibility !== "public") fd.append("roles_allowed", rolesAllowed);
      fd.append("summary", summary);
      const { data } = await api.post("/brain/documents", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Added to Company Brain");
      onUploaded(data);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn(SHEET_CONTENT, "max-w-lg")} data-testid="brain-doc-upload-dialog">
        <SheetHead icon={FileText} title="Add a document"
          description="Dex reads it and answers from it. Only the people you choose can open it." onClose={onClose} />
        <div className="space-y-4 px-6 pb-5">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-slate-900/15 bg-white/55 px-4 py-2.5 text-sm transition-colors hover:bg-white/80 focus-within:ring-2 focus-within:ring-neutral-900/25">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-600 ring-1 ring-inset ring-slate-900/[0.06]">
              <Paperclip size={15} weight="bold" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-slate-600">File</span>
              <span className="block truncate text-slate-500">{file ? file.name : "PDF, Word, Excel, text or a photo · up to 25 MB"}</span>
            </span>
            <input type="file" className="sr-only" data-testid="brain-doc-upload-file"
              onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>

          <Field label="Title" htmlFor={`${uid}-title`}>
            <input id={`${uid}-title`} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="brain-doc-upload-title"
              placeholder={file?.name || "e.g. Leave Policy 2026"} className={FIELD} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind" htmlFor={`${uid}-kind`}>
              <GlassSelect id={`${uid}-kind`} variant="field" triggerClassName={FIELD} testid="brain-doc-upload-kind" ariaLabel="Kind"
                value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.key, label: k.label }))} />
            </Field>
            <Field label="Tags" htmlFor={`${uid}-tags`}>
              <input id={`${uid}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} data-testid="brain-doc-upload-tags"
                placeholder="hr, leave" className={FIELD} />
            </Field>
          </div>

          <Field label="Who can see this?" htmlFor={`${uid}-vis`}>
            <GlassSelect id={`${uid}-vis`} variant="field" triggerClassName={FIELD} testid="brain-doc-upload-visibility" ariaLabel="Who can see this?"
              value={visibility} onChange={setVisibility} options={VISIBILITIES.map((v) => ({ value: v.key, label: v.label }))} />
          </Field>

          {visibility === "dept" && (
            <Field label="Department" htmlFor={`${uid}-dept`}>
              <input id={`${uid}-dept`} value={department} onChange={(e) => setDepartment(e.target.value)} data-testid="brain-doc-upload-department"
                placeholder="finance, sales, operations…" className={FIELD} />
            </Field>
          )}
          {visibility !== "public" && (
            <Field label="Also allow these roles (optional)" htmlFor={`${uid}-roles`}>
              <input id={`${uid}-roles`} value={rolesAllowed} onChange={(e) => setRolesAllowed(e.target.value)} data-testid="brain-doc-upload-roles"
                placeholder="finance, hr" className={FIELD} />
            </Field>
          )}

          <Field label="Short summary (optional)" htmlFor={`${uid}-summary`}>
            <textarea id={`${uid}-summary`} value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} data-testid="brain-doc-upload-summary"
              placeholder="One line Dex can use to match this document to questions." className={cn(AREA, "resize-none")} />
          </Field>
        </div>
        <SheetFoot onCancel={onClose} onSave={submit} busy={busy} disabled={!file} testid="brain-doc-upload-submit"
          saveLabel="Add to Brain" busyLabel="Adding…" />
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Documents panel — used as a tab inside /brain
// -----------------------------------------------------------------------------
const INDEX_NOTE = {
  waiting_for_ai_consent: "Not searchable by Dex yet — AI is switched off for this company (Settings › Business).",
  no_text: "Dex can't read text in this file — keyword search still finds it by title and tags.",
  failed: "Dex couldn't read this file — it will retry on the next restart.",
};

export function DocumentsPanel({ focusId = null }) {
  const { user } = useAuth();
  const isOwner = user?.role === "owner" || (user?.permissions || []).includes("team_manage");
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const searchTimer = useRef(null);

  const load = async (query = q, kindFilter = kind) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (kindFilter) params.set("kind", kindFilter);
      const { data } = await api.get(`/brain/documents?${params.toString()}`);
      setDocs(data || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't load documents");
    } finally {
      setLoading(false);
    }
  };
  // `load` is redeclared every render and closes over q/kind, so listing it
  // would re-run this on every render — an endless refetch. Typing in the
  // search box calls load() itself, debounced, just below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); /* initial load */ }, []);
  // 2026-10-05 — opened from an answer's Document source: show that one.
  useEffect(() => {
    if (!focusId || loading) return;
    document.querySelector(`[data-testid="brain-doc-card-${focusId}"]`)?.scrollIntoView({ block: "center" });
  }, [focusId, loading, docs]);

  const onQChange = (v) => {
    setQ(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(v, kind), 250);
  };

  /* 2026-10-02 — ASKED IN THE APP, NOT BY THE BROWSER. This was
     window.confirm, which some embed contexts (the Capacitor WebView among
     them) answer false with nothing drawn, so Delete looked broken. Same fault
     ASK-2 fixed on Workflows and FUP-49 on My Work. */
  const [pendingDelete, setPendingDelete] = useState(null);
  const remove = (doc) => { if (!deleting) setPendingDelete(doc); };
  const confirmRemove = async () => {
    const doc = pendingDelete;
    if (!doc || deleting) return;
    setDeleting(doc.id);
    try {
      await api.delete(`/brain/documents/${doc.id}`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success("Removed from Company Brain");
      setPendingDelete(null);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't delete");
    } finally {
      setDeleting(null);
    }
  };

  // A download in a browser, the share sheet in the app (lib/native/files).
  const download = (doc) => downloadFrom(`/brain/documents/${doc.id}/download`, doc.filename || doc.title,
    { failed: "Couldn't download" });

  return (
    <div data-testid="brain-documents-panel">
      {/* Search + filter + upload — 2026-10-12 (founder): the app's own pills,
          a glass dropdown and the ink button, where these were the
          pre-redesign square tiles, a native dropdown and a blue button. */}
      <div className="mb-2 flex max-w-3xl flex-col gap-2 md:flex-row md:items-center">
        <div className="ng-pressed flex min-w-0 flex-1 items-center rounded-pill">
          <MagnifyingGlass size={16} className="ml-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            data-testid="brain-doc-search"
            value={q} onChange={(e) => onQChange(e.target.value)}
            placeholder="Search by title, tag or keyword…"
            aria-label="Search documents"
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm outline-none"
          />
        </div>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 md:w-44 md:flex-none">
            <GlassSelect testid="brain-doc-kind-filter" ariaLabel="Kind of document" triggerClassName="h-11 text-sm"
              value={kind} onChange={(v) => { setKind(v); load(q, v); }}
              options={[{ value: "", label: "All kinds" }, ...KINDS.map((k) => ({ value: k.key, label: k.label }))]} />
          </div>
          {isOwner && (
            <button onClick={() => setShowUpload(true)} data-testid="brain-doc-add-btn"
              className={`flex h-11 shrink-0 items-center gap-2 rounded-pill px-5 text-sm font-semibold ${INK_PILL}`}>
              <Upload size={15} weight="bold" aria-hidden="true" /> Add document
            </button>
          )}
        </div>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        Dump the policies, filings, contracts and old reports here — employees can find them by asking Dex or searching.
      </p>

      {/* B?? — skeleton rows instead of a bare "Loading…", so the list area
          doesn't flash empty-then-content while the docs query resolves. */}
      {loading && (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-24 rounded-cardlg" />)}
        </div>
      )}
      {!loading && docs.length === 0 && (
        <EmptyState
          title={q || kind ? "No documents match your search" : "No documents in the Brain yet"}
          hint={isOwner
            ? "Upload the leave policy, GST filings, vendor contracts or SOPs to help your team self-serve."
            : "Ask your workspace owner to add documents like policies, filings or contracts."} />
      )}

      {!loading && docs.length > 0 && (
        /* 2026-10-14 — grid-cols-1, not an implicit column. With no template a
           phone's single column was `auto`, sized to the widest card's
           min-content — and a `truncate` title never wraps, so one long camera
           filename ("JPEG_20261004_072153_8913018500…") made the column, and
           every card in it, wider than the screen: the size and date were cut
           off at the right edge. grid-cols-1 is minmax(0, 1fr), so the column
           is the screen's width and the title truncates as it was meant to. */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="brain-doc-grid">
          {docs.map((d) => (
            <div key={d.id} data-testid={`brain-doc-card-${d.id}`}
              className={cn("ng-bento flex min-w-0 flex-col gap-3 p-4", d.id === focusId && "ring-2 ring-[hsl(var(--ng-ink))]")}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-slate-700 ring-1 ring-inset ring-slate-900/[0.06]">
                    <File size={16} weight="bold" aria-hidden="true" />
                  </span>
                  <p className="truncate text-sm font-semibold leading-tight text-slate-900">{d.title}</p>
                </div>
                <span className="shrink-0 rounded-pill bg-slate-900/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-slate-600">{KIND_LABEL[d.kind] || d.kind}</span>
              </div>
              {d.summary && <p className="text-xs text-muted-foreground leading-relaxed">{d.summary}</p>}
              {/* 2026-10-05 — why Ask can't find something in this file. */}
              {INDEX_NOTE[d.index_state] && (
                <p className="text-[11px] text-caution-600" data-testid={`brain-doc-index-${d.id}`}>{INDEX_NOTE[d.index_state]}</p>
              )}
              {(d.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {d.tags.map((t) => (
                    <span key={t} className="rounded-pill bg-white/80 px-2 py-0.5 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-900/[0.06]">#{t}</span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between border-t border-slate-900/[0.06] pt-2 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {d.visibility === "public"
                    ? "Everyone"
                    : d.visibility === "dept"
                      ? <><Lock size={10} weight="bold" /> {d.department || "dept"} only</>
                      : <><Lock size={10} weight="bold" /> Restricted</>}
                </span>
                <span>{fmtSize(d.size)} · {fmtDate(d.created_at)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => download(d)} data-testid={`brain-doc-download-${d.id}`}
                  className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-pill text-xs font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
                  <DownloadSimple size={13} weight="bold" aria-hidden="true" /> Download
                </button>
                {(isOwner || d.uploaded_by === user?.id) && (
                  <button onClick={() => remove(d)} disabled={deleting === d.id} data-testid={`brain-doc-delete-${d.id}`}
                    aria-label={`Remove ${d.title}`}
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-600 transition-colors hover:bg-white hover:text-rose-700 disabled:opacity-40 ${GLASS_PILL}`}>
                    {deleting === d.id ? <Loader size={14} /> : <Trash size={14} weight="bold" aria-hidden="true" />}
                  </button>
                )}
                {d.uploaded_by && d.uploaded_by !== user?.id && (
                  <ReportButton kind="content" targetType="file" targetId={d.id}
                    snapshot={[d.title, d.summary].filter(Boolean).join("\n")} size={12}
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full max-lg:my-0 ${GLASS_PILL}`} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && <UploadDialog onClose={() => setShowUpload(false)} onUploaded={(d) => setDocs((prev) => [d, ...prev])} />}

      <ConfirmAction
        open={!!pendingDelete}
        onOpenChange={() => setPendingDelete(null)}
        title="Remove this from the Company Brain?"
        description={pendingDelete
          ? `Nobody will be able to find or open “${pendingDelete.title}” again, and Dex will stop answering from it. This can't be undone.`
          : ""}
        confirmLabel="Remove it"
        busyLabel="Removing…"
        cancelLabel="Keep it"
        busy={!!deleting}
        onConfirm={confirmRemove}
        testid="brain-delete-confirm" />
    </div>
  );
}
