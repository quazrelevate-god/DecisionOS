// Extracted from Ingest.js in Sprint 4 E2-30 (2026-08-15) so Ingest.js
// can be retired. Rendered by Ledger.js on the Overview tab sidebar as
// the WhatsApp status card + owner-only inbound message log.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { ArrowClockwise, WhatsappLogo } from "@phosphor-icons/react";

import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Chip } from "../../components/common";
import { timeAgo } from "../../lib/format";

const WA_STATUS_STYLE = {
  received: "bg-caution-50 text-caution-800",
  draft: "bg-brand-50 text-brand-700",
  attention: "bg-amber-500 text-black",
  filed: "bg-green-600 text-white",
  structured: "bg-green-600 text-white",
  ignored: "bg-black/10 text-black",
  rejected: "bg-danger-600 text-white",
  signature_mismatch: "bg-orange-500 text-white",
  error: "bg-danger-600 text-white",
};

export default function WhatsAppCard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";
  const { data: st } = useQuery({ queryKey: ["wa-status"], queryFn: () => api.get("/whatsapp/status").then((r) => r.data) });
  const { data: logs } = useQuery({
    queryKey: ["wa-logs"], enabled: isOwner, refetchInterval: 15000,
    queryFn: () => api.get("/whatsapp/logs").then((r) => r.data),
  });
  const waNum = st?.wa_number;
  const waLink = waNum ? `https://wa.me/${waNum}?text=${encodeURIComponent("Hi DecisionOS")}` : null;

  return (
    <div className="card-brutal p-5 mb-6" data-testid="whatsapp-card">
      {!st?.configured && (
        <div className="flex items-center gap-2 mb-4">
          <Chip value="not connected" className="bg-brand-600 text-white" />
        </div>
      )}

      <div className="grid md:grid-cols-[auto_1fr] gap-6">
        <div className="flex flex-col items-center text-center">
          {waLink ? (
            <a href={waLink} target="_blank" rel="noreferrer" data-testid="whatsapp-qr-link"
              className="border border-border rounded-xl p-2.5 bg-white shadow-sm transition-all">
              <QRCodeSVG value={waLink} size={132} level="M" />
            </a>
          ) : (
            <div className="border-2 border-dashed border-border p-6 w-full">
              <p className="text-sm font-semibold">WhatsApp not connected yet</p>
              <p className="text-xs text-muted-foreground mt-1">{st?.token_error || "Add the WhatsApp credentials in your environment to enable forwarding."}</p>
            </div>
          )}
        </div>

        <div>
          {isOwner && st && st.token_error && (
            <div className="flex items-center gap-2 mb-3 border border-danger-600/30 bg-danger-600/5 rounded-lg px-3 py-2" data-testid="whatsapp-token-error">
              <Chip value="connection issue" className="bg-brand-600 text-white" />
              <span className="text-xs text-muted-foreground">{st.token_error}</span>
            </div>
          )}

          {isOwner ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="label-mono font-bold text-green-600 flex items-center gap-1.5">
                  <WhatsappLogo size={16} weight="bold" className="text-green-600" /> Recent WhatsApp activity
                </p>
                <button data-testid="whatsapp-logs-refresh" onClick={() => qc.invalidateQueries({ queryKey: ["wa-logs"] })}
                  className="flex items-center gap-1 text-xs font-medium rounded-lg border border-border px-2 py-1 hover:bg-accent transition-colors">
                  <ArrowClockwise size={12} weight="bold" /> Refresh
                </button>
              </div>
              {(logs || []).length === 0 ? (
                <div className="border border-border p-3 text-xs text-muted-foreground" data-testid="whatsapp-logs-empty">
                  No inbound messages logged yet. Scan the QR and send a test message — it will appear here within seconds. If nothing shows after sending, the webhook isn't reaching the app (check Meta → WhatsApp → Configuration: callback URL, <span className="font-mono">messages</span> field subscribed, and app published).
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto" data-testid="whatsapp-logs-list">
                  {logs.map((l, i) => (
                    <div key={`${l.created_at || ""}-${l.from || ""}-${i}`} data-testid={`whatsapp-log-${i}`} className="border border-border p-2 flex items-start gap-2 flex-wrap">
                      <Chip value={l.status} className={WA_STATUS_STYLE[l.status] || "bg-black/10 text-black"} />
                      <span className="label-mono text-muted-foreground">{l.mtype || "—"}</span>
                      <span className="text-xs font-mono">{l.from || "unknown"}</span>
                      <span className="text-xs text-muted-foreground flex-1 min-w-[120px]">{l.summary || l.reason || ""}</span>
                      <span className="label-mono text-muted-foreground">{timeAgo(l.updated_at || l.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Scan the code to forward an invoice, receipt or a quick note. It files itself into DecisionOS.</p>
          )}
        </div>
      </div>
    </div>
  );
}
