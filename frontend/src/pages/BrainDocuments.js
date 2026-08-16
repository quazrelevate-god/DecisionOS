import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload, MagnifyingGlass, File, Trash, PencilSimple, DownloadSimple, Lock,
  CircleNotch, X,
} from "@phosphor-icons/react";
import api from "../lib/api";
import { EmptyState } from "../components/common";
import { useAuth } from "../context/AuthContext";

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
const KIND_TINT = {
  policy: "bg-brand-yellow/40", filing: "bg-brand-blue/20", contract: "bg-white",
  sop: "bg-brand-600/10", report: "bg-brand-paper", note: "bg-white", other: "bg-white",
};

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
// -----------------------------------------------------------------------------
function UploadDialog({ onClose, onUploaded }) {
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
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4" data-testid="brain-doc-upload-dialog">
      <div className="w-full max-w-lg bg-brand-paper border-2 border-black shadow-brutal max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-black px-5 py-3">
          <p className="font-heading font-black uppercase tracking-tight">Add a document</p>
          <button onClick={onClose} data-testid="brain-doc-upload-close" className="w-8 h-8 flex items-center justify-center hover:bg-black/5">
            <X size={16} weight="bold" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="label-mono text-muted-foreground">File</span>
            <input
              type="file" data-testid="brain-doc-upload-file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm border border-black bg-white file:mr-3 file:py-2 file:px-4 file:border-0 file:border-r file:border-black file:bg-brand-ink file:text-white file:font-semibold file:uppercase file:tracking-wider file:text-xs" />
            <span className="text-[11px] text-muted-foreground font-mono mt-1 block">PDF · DOCX · XLSX · TXT · images · 25MB max</span>
          </label>

          <label className="block">
            <span className="label-mono text-muted-foreground">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="brain-doc-upload-title"
              placeholder={file?.name || "e.g. Leave Policy 2026"}
              className="mt-1 w-full px-3 py-2 border border-black bg-white text-sm focus:outline-none" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label-mono text-muted-foreground">Kind</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} data-testid="brain-doc-upload-kind"
                className="mt-1 w-full px-3 py-2 border border-black bg-white text-sm focus:outline-none">
                {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-mono text-muted-foreground">Tags (comma-separated)</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} data-testid="brain-doc-upload-tags"
                placeholder="hr, leave, holiday"
                className="mt-1 w-full px-3 py-2 border border-black bg-white text-sm focus:outline-none" />
            </label>
          </div>

          <label className="block">
            <span className="label-mono text-muted-foreground">Who can see this?</span>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value)} data-testid="brain-doc-upload-visibility"
              className="mt-1 w-full px-3 py-2 border border-black bg-white text-sm focus:outline-none">
              {VISIBILITIES.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </label>

          {visibility === "dept" && (
            <label className="block">
              <span className="label-mono text-muted-foreground">Department (role key)</span>
              <input value={department} onChange={(e) => setDepartment(e.target.value)} data-testid="brain-doc-upload-department"
                placeholder="finance, sales, operations…"
                className="mt-1 w-full px-3 py-2 border border-black bg-white text-sm focus:outline-none" />
            </label>
          )}
          {visibility !== "public" && (
            <label className="block">
              <span className="label-mono text-muted-foreground">Also allow these roles (optional)</span>
              <input value={rolesAllowed} onChange={(e) => setRolesAllowed(e.target.value)} data-testid="brain-doc-upload-roles"
                placeholder="finance, hr"
                className="mt-1 w-full px-3 py-2 border border-black bg-white text-sm focus:outline-none" />
            </label>
          )}

          <label className="block">
            <span className="label-mono text-muted-foreground">Short summary (optional)</span>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} data-testid="brain-doc-upload-summary"
              placeholder="One-line description Dex will use to help match this document to questions."
              className="mt-1 w-full px-3 py-2 border border-black bg-white text-sm focus:outline-none resize-none" />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-black px-5 py-3 bg-white">
          <button onClick={onClose} className="px-4 py-2 border border-black text-xs font-semibold uppercase tracking-wider hover:bg-black/5">Cancel</button>
          <button onClick={submit} disabled={busy || !file} data-testid="brain-doc-upload-submit"
            className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2 border border-black text-xs font-semibold uppercase tracking-wider hover:shadow-brutal-sm transition-all disabled:opacity-40">
            {busy ? <CircleNotch size={14} className="animate-spin" /> : <Upload size={14} weight="bold" />}
            {busy ? "Adding…" : "Add to Brain"}
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Documents panel — used as a tab inside /brain
// -----------------------------------------------------------------------------
export function DocumentsPanel() {
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
  useEffect(() => { load(); /* initial load */ }, []);

  const onQChange = (v) => {
    setQ(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(v, kind), 250);
  };

  const remove = async (doc) => {
    if (deleting) return;
    const ok = window.confirm(`Delete "${doc.title}"? Employees will no longer be able to find or open this document.`);
    if (!ok) return;
    setDeleting(doc.id);
    try {
      await api.delete(`/brain/documents/${doc.id}`);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success("Removed from Company Brain");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't delete");
    } finally {
      setDeleting(null);
    }
  };

  const download = async (doc) => {
    try {
      const res = await api.get(`/brain/documents/${doc.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = doc.filename || doc.title;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't download");
    }
  };

  return (
    <div data-testid="brain-documents-panel">
      {/* Search + filter + upload */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 mb-2 max-w-3xl">
        <div className="flex-1 flex items-center border border-black bg-white px-4">
          <MagnifyingGlass size={18} weight="bold" className="text-muted-foreground" />
          <input
            data-testid="brain-doc-search"
            value={q} onChange={(e) => onQChange(e.target.value)}
            placeholder="Search by title, tag or keyword…"
            className="flex-1 py-3 px-3 text-sm font-mono focus:outline-none"
          />
        </div>
        <select value={kind} onChange={(e) => { setKind(e.target.value); load(q, e.target.value); }}
          data-testid="brain-doc-kind-filter"
          className="px-3 py-2 border border-black bg-white text-sm font-mono focus:outline-none min-w-[140px]">
          <option value="">All kinds</option>
          {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        {isOwner && (
          <button onClick={() => setShowUpload(true)} data-testid="brain-doc-add-btn"
            className="flex items-center gap-2 bg-brand-600 text-white px-5 py-3 border border-black text-xs font-semibold uppercase tracking-wider hover:shadow-brutal transition-all">
            <Upload size={14} weight="bold" /> Add document
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-8">
        Dump the policies, filings, contracts and old reports here — employees can find them by asking Dex or searching.
      </p>

      {loading && <p className="font-mono text-sm">Loading…</p>}
      {!loading && docs.length === 0 && (
        <EmptyState
          title={q || kind ? "No documents match your search" : "No documents in the Brain yet"}
          hint={isOwner
            ? "Upload the leave policy, GST filings, vendor contracts or SOPs to help your team self-serve."
            : "Ask your workspace owner to add documents like policies, filings or contracts."} />
      )}

      {!loading && docs.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="brain-doc-grid">
          {docs.map((d) => (
            <div key={d.id} data-testid={`brain-doc-card-${d.id}`}
              className="border border-black bg-white shadow-brutal-sm p-4 flex flex-col gap-3 hover:shadow-brutal transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <File size={18} weight="bold" className="shrink-0" />
                  <p className="font-heading font-black uppercase tracking-tight text-sm leading-tight truncate">{d.title}</p>
                </div>
                <span className={`px-2 py-0.5 border border-black text-[10px] font-mono uppercase tracking-wider shrink-0 ${KIND_TINT[d.kind] || "bg-white"}`}>{d.kind}</span>
              </div>
              {d.summary && <p className="text-xs text-muted-foreground leading-relaxed">{d.summary}</p>}
              {(d.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {d.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 border border-black/30 text-[10px] font-mono bg-brand-paper">#{t}</span>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground pt-2 border-t border-black/10">
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
                  className="flex-1 flex items-center justify-center gap-1.5 border border-black py-2 text-[11px] font-semibold uppercase tracking-wider bg-white hover:bg-black/5">
                  <DownloadSimple size={12} weight="bold" /> Download
                </button>
                {(isOwner || d.uploaded_by === user?.id) && (
                  <button onClick={() => remove(d)} disabled={deleting === d.id} data-testid={`brain-doc-delete-${d.id}`}
                    className="flex items-center justify-center gap-1.5 border border-black py-2 px-3 text-[11px] font-semibold uppercase tracking-wider bg-white hover:bg-brand-600 hover:text-white transition-colors disabled:opacity-40">
                    {deleting === d.id ? <CircleNotch size={12} className="animate-spin" /> : <Trash size={12} weight="bold" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showUpload && <UploadDialog onClose={() => setShowUpload(false)} onUploaded={(d) => setDocs((prev) => [d, ...prev])} />}
    </div>
  );
}
