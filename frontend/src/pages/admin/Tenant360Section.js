// Tenant 360 & cross-tenant search (Epic 10 Sprint 1).
// Self-contained admin section: search workspaces/users, drill into a consolidated
// per-workspace view (plan, members, AI spend, counts, activity, health).
import { useState, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, Circle } from "@phosphor-icons/react";

const CARD = "border border-white/10 bg-[#141418] p-5";
const H2 = "font-heading text-lg font-black uppercase tracking-tight text-white";
const BTN = "font-mono text-[11px] uppercase tracking-wider px-3 py-2 border transition-colors";

function Loading() {
  return (
    <div className="flex items-center gap-2 text-white/40 font-mono text-sm py-10 justify-center">
      <Spinner size={16} className="animate-spin" /> Loading…
    </div>
  );
}

function Badge({ ok, label }) {
  const color = ok ? "#3fb950" : "#e5484d";
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2 py-1 border"
      style={{ color, borderColor: `${color}55`, background: `${color}12` }}
    >
      <Circle size={7} weight="fill" style={{ color }} />
      {label}
    </span>
  );
}

function Stat({ label, value }) {
  return (
    <div className={CARD + " py-3 px-4"}>
      <div className="font-heading text-2xl font-black text-white tracking-tighter">{value ?? 0}</div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mt-0.5">{label}</div>
    </div>
  );
}

export function Tenant360Section() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async (term) => {
    if (!term || term.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    try {
      const r = await api.get(`/admin/search?q=${encodeURIComponent(term.trim())}`);
      setResults(r.data);
    } catch (e) { toast.error(formatApiError(e)); } finally { setSearching(false); }
  }, []);

  const openTenant = useCallback(async (tid) => {
    setLoading(true); setSel(null);
    try {
      const r = await api.get(`/admin/tenants/${tid}/360`);
      setSel(r.data);
    } catch (e) { toast.error(formatApiError(e)); } finally { setLoading(false); }
  }, []);

  const ts = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

  return (
    <div data-testid="admin-tenant360">
      <h2 className={H2 + " mb-4"}>Tenant 360</h2>
      <form onSubmit={(e) => { e.preventDefault(); runSearch(q); }} className="flex gap-2 mb-5 max-w-xl">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search workspaces or users — name, email, phone, id…"
          data-testid="tenant360-search"
          className="flex-1 bg-[#0a0a0b] border border-white/10 px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-[#e5484d] outline-none"
        />
        <button type="submit" className={BTN + " border-[#e5484d]/50 text-[#e5484d] hover:bg-[#e5484d]/10"}>
          {searching ? <Spinner size={13} className="animate-spin" /> : "Search"}
        </button>
      </form>

      {results && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2">
              Workspaces ({results.tenants.length})
            </div>
            <div className="space-y-1">
              {results.tenants.map((t) => (
                <button key={t.id} onClick={() => openTenant(t.id)}
                  className="w-full text-left border border-white/10 bg-[#141418] px-3 py-2 hover:border-[#e5484d]/50 transition-colors">
                  <div className="text-white text-sm">{t.name}</div>
                  <div className="font-mono text-[10px] text-white/40">
                    {t.plan || "—"} · {t.suspended ? "suspended" : "active"} · {String(t.id).slice(0, 8)}
                  </div>
                </button>
              ))}
              {results.tenants.length === 0 && <div className="font-mono text-xs text-white/30">No workspaces</div>}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2">
              Users ({results.users.length})
            </div>
            <div className="space-y-1">
              {results.users.map((u) => (
                <button key={u.id} onClick={() => u.tenant_id && openTenant(u.tenant_id)}
                  className="w-full text-left border border-white/10 bg-[#141418] px-3 py-2 hover:border-[#e5484d]/50 transition-colors">
                  <div className="text-white text-sm">{u.name} <span className="text-white/30 text-xs">· {u.role}</span></div>
                  <div className="font-mono text-[10px] text-white/40">{u.email || u.phone || "—"} · {u.tenant_name}</div>
                </button>
              ))}
              {results.users.length === 0 && <div className="font-mono text-xs text-white/30">No users</div>}
            </div>
          </div>
        </div>
      )}

      {loading && <Loading />}

      {sel && (
        <div data-testid="tenant360-detail">
          <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
            <div>
              <div className="font-heading text-xl font-black text-white">{sel.tenant.name}</div>
              <div className="font-mono text-[11px] text-white/40 mt-1">
                {sel.tenant.industry || "—"} · {sel.tenant.region || "—"} · {sel.tenant.currency || "—"} · {sel.tenant.id}
              </div>
            </div>
            <div className="flex gap-2">
              <Badge ok={!sel.tenant.suspended} label={sel.tenant.suspended ? "suspended" : "active"} />
              <span className="inline-flex items-center font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-white/15 text-white/70">
                {sel.tenant.plan || "no plan"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-5">
            <Stat label="Members" value={sel.counts.active_members} />
            <Stat label="Users" value={sel.counts.users} />
            <Stat label="Decisions" value={sel.counts.decisions} />
            <Stat label="Tasks" value={sel.counts.tasks} />
            <Stat label="Workflows" value={sel.counts.workflows} />
            <Stat label="People" value={sel.counts.contacts} />
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-5">
            <div className={CARD}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2">AI Spend</div>
              <div className="text-white text-sm">30d: <span className="font-heading font-black">${sel.spend.last_30d.cost}</span> ({sel.spend.last_30d.calls} calls)</div>
              <div className="text-white/60 text-sm mt-1">All-time: ${sel.spend.all_time.cost} ({sel.spend.all_time.calls} calls)</div>
            </div>
            <div className={CARD}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2">Entitlements</div>
              <div className="text-white/80 text-sm">Seat limit: {sel.tenant.seat_limit_override ?? sel.tenant.seat_limit ?? "—"}</div>
              <div className="text-white/80 text-sm mt-1">AI consent: {sel.tenant.ai_consent ? "granted" : "not granted"}</div>
              <div className="text-white/80 text-sm mt-1">GST: {sel.tenant.gst || "—"}</div>
            </div>
            <div className={CARD}>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2">Health</div>
              <div className="text-white/80 text-sm">Last activity: {ts(sel.health.last_activity)}</div>
              <div className="text-white/80 text-sm mt-1">Tasks done: {sel.counts.tasks_done}/{sel.counts.tasks}</div>
              <div className="text-white/80 text-sm mt-1">Open complaints: {sel.counts.complaints}</div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2">Members ({sel.members.length})</div>
              <div className="border border-white/10 divide-y divide-white/5">
                {sel.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-[#141418]">
                    <div className="text-white text-sm">{m.name} <span className="text-white/30 text-xs">· {m.role}</span></div>
                    {m.suspended
                      ? <span className="font-mono text-[10px] text-[#e5484d]">suspended</span>
                      : <span className="font-mono text-[10px] text-[#3fb950]">active</span>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2">Recent activity</div>
              <div className="border border-white/10 divide-y divide-white/5 max-h-72 overflow-y-auto">
                {sel.activity.map((a, i) => (
                  <div key={i} className="px-3 py-2 bg-[#141418]">
                    <div className="text-white/80 text-xs">{a.message}</div>
                    <div className="font-mono text-[9px] text-white/30 mt-0.5">{ts(a.created_at)} · {a.kind}</div>
                  </div>
                ))}
                {sel.activity.length === 0 && <div className="px-3 py-2 font-mono text-xs text-white/30">No activity</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
