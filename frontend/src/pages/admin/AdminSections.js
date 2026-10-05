import { ADMIN_BTN, ADMIN_H2, CARD_BASE } from "./adminStyle";
import { roleLabel } from "../../lib/departments";
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import {
  Buildings, Users, Brain, CheckSquare, Lightning, ArrowsClockwise,
  PencilSimple, Prohibit, ArrowClockwise, ShieldCheck, Spinner, Circle,
  SignIn, SignOut, Key as KeyIcon, ClockCounterClockwise,
  ChartBar, CurrencyDollar, WarningCircle, Coins, Trash,
} from "@phosphor-icons/react";

// --- shared bits ------------------------------------------------------------
const STATUS_COLORS = {
  active: "#116329",
  fallback: "#7d4e00",
  out_of_credits: "#cf222e",
  invalid: "#cf222e",
  error: "#cf222e",
  not_set: "#57606a",
};

function StatusBadge({ status, detail }) {
  const color = STATUS_COLORS[status] || "#57606a";
  const label = (status || "unknown").replace(/_/g, " ");
  return (
    <span
      title={detail || ""}
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2 py-1 border"
      style={{ color, borderColor: `${color}55`, background: `${color}12` }}
    >
      <Circle size={7} weight="fill" style={{ color }} />
      {label}
    </span>
  );
}

const CARD = `${CARD_BASE} p-5`;
const H2 = ADMIN_H2;
const BTN = ADMIN_BTN;

function Loading() {
  return (
    <div className="flex items-center gap-2 text-slate-600 font-mono text-sm py-10 justify-center">
      <Spinner size={16} className="animate-spin" /> Loading…
    </div>
  );
}

// --- Overview ---------------------------------------------------------------
export function OverviewSection() {
  const [m, setM] = useState(null);
  useEffect(() => {
    api.get("/admin/metrics").then((r) => setM(r.data)).catch(() => {});
  }, []);
  if (!m) return <Loading />;
  const cards = [
    { k: "tenants", label: "Workspaces", icon: Buildings, v: m.tenants },
    { k: "users", label: "Users", icon: Users, v: m.users },
    { k: "decisions", label: "Decisions", icon: Brain, v: m.decisions },
    { k: "tasks", label: "Tasks", icon: CheckSquare, v: m.tasks },
    { k: "captures", label: "Captures", icon: Lightning, v: m.captures },
    { k: "workflows", label: "Workflows", icon: ArrowsClockwise, v: m.workflows },
    { k: "contacts", label: "People", icon: Users, v: m.contacts },
    { k: "tasks_done", label: "Tasks Done", icon: CheckSquare, v: m.tasks_done },
  ];
  return (
    <div data-testid="admin-overview">
      <h2 className={H2 + " mb-5"}>Platform Metrics</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.k} className={CARD} data-testid={`metric-${c.k}`}>
            <c.icon size={20} className="text-[#b91c1c] mb-3" weight="bold" />
            <div className="font-display text-4xl text-slate-900 ">{c.v}</div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-slate-600 mt-1">{c.label}</div>
          </div>
        ))}
      </div>
      {m.suspended_users > 0 && (
        <p className="mt-4 font-mono text-xs text-[#7d4e00]">{m.suspended_users} suspended user(s)</p>
      )}
    </div>
  );
}

// --- AI Keys ----------------------------------------------------------------
export function AiKeysSection() {
  const [keys, setKeys] = useState(null);
  const [status, setStatus] = useState({});
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(() => {
    api.get("/admin/ai-keys").then((r) => setKeys(r.data.keys)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const test = async () => {
    setTesting(true);
    try {
      const { data } = await api.get("/admin/ai-keys/status");
      const map = {
        sarvam: data.sarvam,
        anthropic: data.anthropic, openai: data.openai, gemini: data.gemini,
        wa_access_token: data.whatsapp, wa_phone_number_id: data.whatsapp,
      };
      setStatus(map);
    } catch (e) {
      toast.error("Status check failed");
    } finally {
      setTesting(false);
    }
  };

  const save = async (provider) => {
    try {
      await api.put("/admin/ai-keys", { [provider]: draft });
      toast.success(draft ? "Key updated" : "Reverted to environment default");
      setEditing(null);
      setDraft("");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  if (!keys) return <Loading />;
  return (
    <div data-testid="admin-ai-keys">
      <div className="flex items-center justify-between mb-5">
        <h2 className={H2}>AI Provider Keys</h2>
        <button
          data-testid="test-all-keys"
          onClick={test}
          disabled={testing}
          className={BTN + " border-[#cf222e] text-[#b91c1c] hover:bg-[#cf222e] hover:text-white flex items-center gap-2"}
        >
          {testing ? <Spinner size={13} className="animate-spin" /> : <ArrowClockwise size={13} />}
          {testing ? "Testing…" : "Test All Keys"}
        </button>
      </div>
      <div className="space-y-3">
        {keys.map((k) => (
          <div key={k.provider} className={CARD} data-testid={`ai-key-${k.provider}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-display text-slate-900 text-sm ">{k.label}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 border border-slate-900/15 px-2 py-0.5 rounded-xl">
                    {k.source === "custom" ? "custom" : k.source === "env" ? "env default" : "not set"}
                  </span>
                  {status[k.provider] && <StatusBadge status={status[k.provider].status} detail={status[k.provider].detail} />}
                </div>
                <div className="font-mono text-xs text-slate-600 mt-2">{k.masked || "— not set —"}</div>
                {k.note && <div className="font-mono text-[10px] text-[#7d4e00] mt-1">{k.note}</div>}
              </div>
              <button
                data-testid={`edit-key-${k.provider}`}
                onClick={() => { setEditing(k.provider); setDraft(""); }}
                className={BTN + " border-slate-900/20 text-slate-600 hover:border-slate-900/50 flex items-center gap-1.5 shrink-0"}
              >
                <PencilSimple size={13} /> Update
              </button>
            </div>
            {editing === k.provider && (
              <div className="mt-4 pt-4 border-t border-slate-900/10 space-y-3" data-testid={`edit-panel-${k.provider}`}>
                <input
                  data-testid={`key-input-${k.provider}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Paste new key value (leave empty to revert to env default)"
                  className="w-full bg-white border border-slate-900/15 text-slate-900 px-3 py-2.5 font-mono text-xs focus:border-[#cf222e] focus:outline-none rounded-xl"
                />
                <div className="flex gap-2">
                  <button
                    data-testid={`save-key-${k.provider}`}
                    onClick={() => save(k.provider)}
                    className={BTN + " bg-[#cf222e] border-[#cf222e] text-white hover:bg-[#a40e26]"}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditing(null); setDraft(""); }}
                    className={BTN + " border-slate-900/20 text-slate-600 hover:border-slate-900/40"}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Usage / credit consumption per workspace -------------------------------
const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
  { key: "all", label: "All Time" },
];
const PROVIDERS = [
  { key: "all", label: "All" },
  { key: "sarvam", label: "Sarvam STT" },
  { key: "anthropic", label: "Claude" },
  { key: "emergent", label: "Claude (Emergent)" },
  { key: "openai", label: "OpenAI STT" },
  { key: "gemini", label: "Gemini OCR" },
];
const PROVIDER_LABEL = {
  sarvam: "Sarvam voice (Indic STT)", anthropic: "Claude (your key)", emergent: "Claude (Emergent)",
  openai: "OpenAI transcription", gemini: "Gemini document OCR", unknown: "Unknown",
};

function fmtNum(n) {
  if (n == null) return "0";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

export function UsageSection() {
  const [range, setRange] = useState("30d");
  const [provider, setProvider] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/admin/usage?range=${range}&provider=${provider}`)
      .then((r) => { setData(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [range, provider]);

  return (
    <div data-testid="admin-usage">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className={H2}>AI Credit Usage</h2>
        <div className="flex gap-1" data-testid="usage-range">
          {RANGES.map((r) => (
            <button key={r.key} data-testid={`usage-range-${r.key}`} onClick={() => setRange(r.key)}
              className={`font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border transition-colors ${
                range === r.key ? "bg-[#cf222e] border-[#cf222e] text-white" : "border-slate-900/20 text-slate-600 hover:border-slate-900/40"} rounded-xl`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-1 mb-4 flex-wrap" data-testid="usage-provider-filter">
        {PROVIDERS.map((p) => (
          <button key={p.key} data-testid={`usage-provider-${p.key}`} onClick={() => setProvider(p.key)}
            className={`font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 border transition-colors ${
              provider === p.key ? "bg-slate-900/[0.06] border-slate-900/40 text-slate-900" : "border-slate-900/10 text-slate-600 hover:border-slate-900/25"} rounded-xl`}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="font-mono text-[11px] text-slate-600 mb-5">
        Covers all providers — Sarvam (Indic voice transcription), Claude (text), OpenAI (voice fallback) & Gemini (document OCR). Costs are estimates
        (tokens ≈ chars/4; STT by audio duration), not exact provider billing.
      </p>
      {loading || !data ? <Loading /> : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className={CARD} data-testid="usage-total-calls">
              <ChartBar size={20} className="text-[#b91c1c] mb-2" weight="bold" />
              <div className="font-display text-3xl text-slate-900 ">{fmtNum(data.totals.calls)}</div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-slate-600 mt-1">AI Calls</div>
            </div>
            <div className={CARD} data-testid="usage-total-tokens">
              <Coins size={20} className="text-[#7d4e00] mb-2" weight="bold" />
              <div className="font-display text-3xl text-slate-900 ">{fmtNum(data.totals.tokens_total)}</div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-slate-600 mt-1">Tokens</div>
            </div>
            <div className={CARD} data-testid="usage-total-cost">
              <CurrencyDollar size={20} className="text-[#116329] mb-2" weight="bold" />
              <div className="font-display text-3xl text-slate-900 ">${data.totals.cost.toFixed(2)}</div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-slate-600 mt-1">Est. Cost</div>
            </div>
          </div>

          {data.by_provider && data.by_provider.length > 0 && (
            <div className="mb-6" data-testid="usage-by-provider">
              <h3 className="font-mono text-[11px] uppercase tracking-widest text-slate-600 mb-3">By Provider</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {data.by_provider.map((p) => (
                  <div key={p.provider} className={CARD} data-testid={`usage-provider-card-${p.provider}`}>
                    <div className="font-display text-slate-900 text-xs ">{PROVIDER_LABEL[p.provider] || p.provider}</div>
                    <div className="font-mono text-[11px] text-slate-600 mt-2">{fmtNum(p.calls)} calls · {fmtNum(p.tokens_total)} tok</div>
                    <div className="font-mono text-sm text-[#116329] mt-1">${p.cost_estimate.toFixed(4)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.workspaces.length === 0 ? (
            <div className={CARD + " text-slate-600 font-mono text-sm"}>No AI usage recorded in this period.</div>
          ) : (
            <div className="overflow-x-auto border border-slate-900/10 rounded-xl">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-900/[0.06] font-mono text-[10px] uppercase tracking-widest text-slate-600">
                    <th className="p-3">Workspace</th><th className="p-3 text-right">Calls</th>
                    <th className="p-3 text-right">Tokens In</th><th className="p-3 text-right">Tokens Out</th>
                    <th className="p-3 text-right">Total</th><th className="p-3 text-right">Est. Cost</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs text-slate-700">
                  {data.workspaces.map((w) => (
                    <tr key={w.tenant_id || "system"} className="border-t border-slate-900/5 hover:bg-slate-900/[0.03]" data-testid={`usage-row-${w.tenant_id || "system"}`}>
                      <td className="p-3 text-slate-900 font-semibold">{w.tenant_name}</td>
                      <td className="p-3 text-right">{fmtNum(w.calls)}</td>
                      <td className="p-3 text-right text-slate-600">{fmtNum(w.tokens_in)}</td>
                      <td className="p-3 text-right text-slate-600">{fmtNum(w.tokens_out)}</td>
                      <td className="p-3 text-right text-[#7d4e00]">{fmtNum(w.tokens_total)}</td>
                      <td className="p-3 text-right text-[#116329]">${w.cost_estimate.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Tenants ----------------------------------------------------------------
export function TenantsSection() {
  const [rows, setRows] = useState(null);
  const [toDelete, setToDelete] = useState(null); // tenant row pending delete confirmation
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const load = useCallback(() => {
    api.get("/admin/tenants").then((r) => setRows(r.data.tenants)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id, action) => {
    try {
      await api.post(`/admin/tenants/${id}/${action}`);
      toast.success(action === "suspend" ? "Workspace suspended" : "Workspace reactivated");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  const nameMatches = toDelete && confirmText.trim().toLowerCase() === toDelete.name.trim().toLowerCase();

  const doDelete = async () => {
    if (!toDelete || !nameMatches) return;
    setDeleting(true);
    try {
      const { data } = await api.delete(`/admin/tenants/${toDelete.id}`);
      toast.success(`"${toDelete.name}" permanently deleted (${data.total_removed} records wiped)`);
      setToDelete(null); setConfirmText("");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally { setDeleting(false); }
  };

  if (!rows) return <Loading />;
  const fmt = (d) => (d ? new Date(d).toLocaleDateString() : "—");
  return (
    <div data-testid="admin-tenants">
      <h2 className={H2 + " mb-5"}>Workspaces ({rows.length})</h2>
      <div className="overflow-x-auto border border-slate-900/10 rounded-xl">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-900/[0.06] font-mono text-[10px] uppercase tracking-widest text-slate-600">
              <th className="p-3">Workspace</th><th className="p-3">Industry</th>
              <th className="p-3 text-right">Users</th><th className="p-3 text-right">Decisions</th>
              <th className="p-3 text-right">Tasks</th><th className="p-3">Created</th>
              <th className="p-3">Status</th><th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs text-slate-700">
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-slate-900/5 hover:bg-slate-900/[0.03]" data-testid={`tenant-row-${t.id}`}>
                <td className="p-3 text-slate-900 font-semibold">{t.name}</td>
                <td className="p-3 text-slate-600">{t.industry}</td>
                <td className="p-3 text-right">{t.users}</td>
                <td className="p-3 text-right">{t.decisions}</td>
                <td className="p-3 text-right">{t.tasks}</td>
                <td className="p-3 text-slate-600">{fmt(t.created_at)}</td>
                <td className="p-3">
                  {t.suspended
                    ? <span className="text-[#b91c1c]">suspended</span>
                    : <span className="text-[#116329]">active</span>}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    {t.suspended ? (
                      <button data-testid={`tenant-reactivate-${t.id}`} onClick={() => act(t.id, "reactivate")}
                        className={BTN + " border-[#116329]/50 text-[#116329] hover:bg-[#116329]/10 py-1 flex items-center gap-1"}>
                        <ArrowClockwise size={12} /> Reactivate
                      </button>
                    ) : (
                      <button data-testid={`tenant-suspend-${t.id}`} onClick={() => act(t.id, "suspend")}
                        className={BTN + " border-[#cf222e]/50 text-[#b91c1c] hover:bg-[#cf222e]/10 py-1 flex items-center gap-1"}>
                        <Prohibit size={12} /> Suspend
                      </button>
                    )}
                    <button data-testid={`tenant-delete-${t.id}`} onClick={() => { setToDelete(t); setConfirmText(""); }}
                      title="Permanently delete this workspace and all its data"
                      className={BTN + " border-slate-900/15 text-slate-600 hover:border-[#cf222e]/60 hover:text-[#b91c1c] hover:bg-[#cf222e]/10 py-1 flex items-center gap-1"}>
                      <Trash size={12} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Permanent-delete confirmation — requires typing the workspace name */}
      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" data-testid="tenant-delete-modal">
          <div className="w-full max-w-md border border-[#cf222e]/40 bg-slate-900/[0.06] p-6 rounded-xl">
            <div className="flex items-center gap-2 mb-3 text-[#b91c1c]">
              <WarningCircle size={20} weight="fill" />
              <h3 className="font-display text-base ">Delete workspace</h3>
            </div>
            <p className="font-mono text-xs text-slate-600 leading-relaxed mb-2">
              This permanently deletes <span className="text-slate-900 font-semibold">{toDelete.name}</span> — all{" "}
              {toDelete.users} user(s), {toDelete.tasks} task(s), {toDelete.decisions} decision(s), invoices, files and
              every other record. <span className="text-[#b91c1c]">This cannot be undone.</span>
            </p>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-600 mt-4 mb-1.5">
              Type <span className="text-slate-900 normal-case tracking-normal">{toDelete.name}</span> to confirm
            </p>
            <input
              autoFocus
              data-testid="tenant-delete-confirm-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doDelete(); }}
              placeholder={toDelete.name}
              className="w-full bg-white border border-slate-900/15 px-3 py-2.5 font-mono text-xs text-slate-900 placeholder:text-slate-300 focus:outline-none focus:border-[#cf222e]/60 rounded-xl"
            />
            <div className="flex items-center justify-end gap-2 mt-5">
              <button data-testid="tenant-delete-cancel" onClick={() => { setToDelete(null); setConfirmText(""); }}
                className={BTN + " border-slate-900/20 text-slate-600 hover:border-slate-900/50"}>
                Cancel
              </button>
              <button
                data-testid="tenant-delete-confirm"
                onClick={doDelete}
                disabled={!nameMatches || deleting}
                className={BTN + " border-[#cf222e] bg-[#cf222e]/15 text-[#b91c1c] hover:bg-[#cf222e]/25 flex items-center gap-1.5 disabled:opacity-30 disabled:cursor-not-allowed"}>
                {deleting ? <Spinner size={13} className="animate-spin" /> : <Trash size={13} />}
                {deleting ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Users ------------------------------------------------------------------
export function UsersSection() {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => {
    api.get("/admin/users").then((r) => setRows(r.data.users)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id, action) => {
    try {
      await api.post(`/admin/users/${id}/${action}`);
      toast.success(`User ${action}d`);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  if (!rows) return <Loading />;
  return (
    <div data-testid="admin-users">
      <h2 className={H2 + " mb-5"}>Users ({rows.length})</h2>
      <div className="overflow-x-auto border border-slate-900/10 rounded-xl">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-900/[0.06] font-mono text-[10px] uppercase tracking-widest text-slate-600">
              <th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Workspace</th>
              <th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs text-slate-700">
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-slate-900/5 hover:bg-slate-900/[0.03]" data-testid={`user-row-${u.id}`}>
                <td className="p-3 text-slate-900 font-semibold">{u.name || "—"}</td>
                <td className="p-3 text-slate-600">{u.email || "—"}</td>
                <td className="p-3 text-slate-600">{u.tenant_name}</td>
                <td className="p-3 text-slate-600">{roleLabel(u.role)}</td>
                <td className="p-3">
                  {u.suspended
                    ? <span className="text-[#b91c1c]">suspended</span>
                    : <span className="text-[#116329]">active</span>}
                </td>
                <td className="p-3">
                  <div className="flex gap-1.5">
                    {u.role !== "owner" && (u.suspended ? (
                      <button data-testid={`reactivate-${u.id}`} onClick={() => act(u.id, "reactivate")}
                        className={BTN + " border-[#116329]/50 text-[#116329] hover:bg-[#116329]/10 py-1 flex items-center gap-1"}>
                        <ArrowClockwise size={12} /> Reactivate
                      </button>
                    ) : (
                      <button data-testid={`suspend-${u.id}`} onClick={() => act(u.id, "suspend")}
                        className={BTN + " border-[#cf222e]/50 text-[#b91c1c] hover:bg-[#cf222e]/10 py-1 flex items-center gap-1"}>
                        <Prohibit size={12} /> Suspend
                      </button>
                    ))}
                    <button data-testid={`reset-access-${u.id}`} onClick={() => act(u.id, "reset-access")}
                      className={BTN + " border-slate-900/20 text-slate-600 hover:border-slate-900/40 py-1"}>
                      Reset Access
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Audit Log --------------------------------------------------------------
const AUDIT_META = {
  login: { icon: SignIn, color: "#57606a" },
  logout: { icon: SignOut, color: "#57606a" },
  update_ai_keys: { icon: KeyIcon, color: "#7d4e00" },
  suspend_user: { icon: Prohibit, color: "#cf222e" },
  reactivate_user: { icon: ArrowClockwise, color: "#116329" },
  suspend_tenant: { icon: Prohibit, color: "#cf222e" },
  reactivate_tenant: { icon: ArrowClockwise, color: "#116329" },
  delete_tenant: { icon: Trash, color: "#cf222e" },
  reset_access: { icon: ArrowsClockwise, color: "#6ea8ff" },
};

export function AuditSection() {
  const [rows, setRows] = useState(null);
  const load = useCallback(() => {
    api.get("/admin/audit").then((r) => setRows(r.data.entries)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <Loading />;
  const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
  return (
    <div data-testid="admin-audit">
      <div className="flex items-center justify-between mb-5">
        <h2 className={H2}>Audit Log</h2>
        <button
          data-testid="audit-refresh"
          onClick={load}
          className={BTN + " border-slate-900/20 text-slate-600 hover:border-slate-900/50 flex items-center gap-1.5"}
        >
          <ArrowClockwise size={13} /> Refresh
        </button>
      </div>
      {rows.length === 0 ? (
        <div className={CARD + " text-slate-600 font-mono text-sm"}>No admin activity recorded yet.</div>
      ) : (
        <div className="border border-slate-900/10 rounded-xl">
          {rows.map((e, i) => {
            const meta = AUDIT_META[e.action] || { icon: ClockCounterClockwise, color: "#57606a" };
            return (
              <div
                key={e.id}
                data-testid={`audit-row-${i}`}
                className="flex items-start gap-3 p-4 border-b border-slate-900/5 last:border-0 hover:bg-slate-900/[0.03]"
              >
                <div
                  className="w-8 h-8 shrink-0 flex items-center justify-center border"
                  style={{ borderColor: `${meta.color}55`, background: `${meta.color}12` }}
                >
                  <meta.icon size={15} weight="bold" style={{ color: meta.color }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm text-slate-800">{e.message}</div>
                  <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                    {e.admin_email} · <span className="uppercase tracking-wider">{(e.action || "").replace(/_/g, " ")}</span>
                  </div>
                </div>
                <div className="font-mono text-[11px] text-slate-600 shrink-0 whitespace-nowrap">{fmt(e.created_at)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Health -----------------------------------------------------------------
export function HealthSection() {
  const [h, setH] = useState(null);
  useEffect(() => {
    api.get("/admin/health").then((r) => setH(r.data)).catch(() => {});
  }, []);
  if (!h) return <Loading />;
  const ok = (v) => v === "ok" || v === "running" || v === "configured";
  const rows = [
    { label: "Database", v: h.database.status },
    { label: "Follow-up Scheduler", v: h.scheduler.status, detail: h.scheduler.detail },
    { label: "Emergent LLM Key", v: h.emergent_key },
  ];
  return (
    <div data-testid="admin-health">
      <h2 className={H2 + " mb-5"}>System Health</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className={CARD} data-testid={`health-${r.label}`}>
            <div className="flex items-center gap-2 mb-2">
              {ok(r.v) ? <ShieldCheck size={18} className="text-[#116329]" weight="fill" />
                : <Circle size={14} weight="fill" className="text-[#b91c1c]" />}
              <span className="font-display text-slate-900 text-sm ">{r.label}</span>
            </div>
            <div className="font-mono text-xs uppercase" style={{ color: ok(r.v) ? "#116329" : "#cf222e" }}>{r.v}</div>
            {r.detail && <div className="font-mono text-[10px] text-slate-600 mt-1">{r.detail}</div>}
          </div>
        ))}
      </div>
      <h3 className="font-mono text-[11px] uppercase tracking-widest text-slate-600 mt-8 mb-3">AI Provider Key Source</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(h.ai_providers).map(([k, v]) => (
          <div key={k} className={CARD}>
            <div className="font-display text-slate-900 text-xs ">{k}</div>
            <div className="font-mono text-[11px] text-slate-600 mt-1 uppercase">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}


