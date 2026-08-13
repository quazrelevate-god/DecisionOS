// Epic 2 Sprint 2 (E2-16 / E2-18 / E2-19 / E2-22) — Decision Desk redesign.
//
// Founder mocks 2026-08-14:
//   - Header: "Decision Desk" + counter subline
//     ("6 decisions waiting on you · 8 on fire · 3 due today")
//   - Four mutually-exclusive chips:
//     Needs Your Decision · On Fire · Due Today · Important
//   - Card grid per chip (title · context line · amount · primary CTA).
//
// Founder ask 2026-08-13 (revised): "we will have the approval of decision
// option here alone" -> the Desk stops being a mixed activity feed.
// Founder confirmation 2026-08-14: keep CAPTURE on the Desk (recording a
// decision is Desk-native). CAPTURE is a compact bar at the top; the
// 4 chips + card grid dominate the page.
//
// Data source: single GET /api/desk?chip=<chip> aggregation endpoint
// (E2-17) — counters + cards in one call.
// Nudge/Chase actions: POST /api/desk/nudge/{item_id} (E2-22).
//
// The old Inbox.js is left orphaned in the tree for one commit so
// nothing breaks in the interim; a follow-up will delete it.

import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import api from "../lib/api";
import { toast } from "sonner";
import { DecisionDialog } from "../components/DecisionDialog";
import {
  Microphone, Stop, PaperPlaneTilt, Paperclip, Fire, Sun, Star,
  CheckCircle, ArrowClockwise, Spinner,
} from "@phosphor-icons/react";


// -----------------------------------------------------------------------------
// Capture bar — compact top-of-Desk affordance
// -----------------------------------------------------------------------------
function CaptureBar({ onCaptured }) {
  const { user } = useAuth();
  const canCapture = user?.role === "owner" || hasPerm(user, "voice_capture");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileRef = useRef(null);

  if (!canCapture) return null;

  const sendText = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.post("/voice-notes/text", { text: text.trim() });
      toast.success("Captured — structuring…");
      setText("");
      onCaptured && onCaptured();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Capture failed");
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "capture.webm");
        fd.append("language", "auto");
        setSending(true);
        try {
          await api.post("/voice-notes", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          toast.success("Voice note captured — structuring…");
          onCaptured && onCaptured();
        } catch (e) {
          toast.error(e.response?.data?.detail || "Upload failed");
        } finally {
          setSending(false);
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      setRecordSecs(0);
      timerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch (e) {
      toast.error("Microphone not available");
    }
  };

  const stopRecording = () => {
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
    setRecording(false);
    clearInterval(timerRef.current);
  };

  const uploadFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    setSending(true);
    try {
      await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("File uploaded");
      onCaptured && onCaptured();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Upload failed");
    } finally {
      setSending(false);
      e.target.value = "";
    }
  };

  return (
    <div className="border border-black bg-white p-3 mb-6" data-testid="desk-capture-bar">
      <div className="flex items-stretch gap-2">
        {!recording && (
          <button
            data-testid="desk-mic-record"
            onClick={startRecording}
            disabled={sending}
            title="Record a voice note"
            className="w-11 h-11 flex items-center justify-center border border-black hover:bg-brand-red hover:text-white transition-colors disabled:opacity-50"
          >
            <Microphone size={18} weight="bold" />
          </button>
        )}
        {recording && (
          <button
            data-testid="desk-mic-stop"
            onClick={stopRecording}
            className="w-11 px-3 flex items-center justify-center gap-2 bg-brand-red text-white font-mono text-xs border border-black animate-pulse"
          >
            <Stop size={16} weight="fill" />
            <span>{recordSecs}s</span>
          </button>
        )}
        <input
          data-testid="desk-text-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendText()}
          disabled={recording || sending}
          placeholder="Type a decision or directive…"
          className="flex-1 border border-black px-3 py-2 text-sm font-mono focus:outline-none disabled:opacity-50"
        />
        <input
          type="file"
          ref={fileRef}
          hidden
          onChange={uploadFile}
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
        />
        <button
          data-testid="desk-file-upload"
          onClick={() => fileRef.current?.click()}
          disabled={sending || recording}
          title="Attach a file"
          className="w-11 h-11 flex items-center justify-center border border-black hover:bg-brand-ink hover:text-white transition-colors disabled:opacity-50"
        >
          <Paperclip size={16} weight="bold" />
        </button>
        <button
          data-testid="desk-send"
          onClick={sendText}
          disabled={!text.trim() || sending || recording}
          className="px-4 flex items-center gap-2 bg-brand-ink text-white text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm disabled:opacity-50 transition-all"
        >
          {sending ? <Spinner size={16} className="animate-spin" /> : <PaperPlaneTilt size={16} weight="bold" />}
          Send
        </button>
      </div>
    </div>
  );
}


// -----------------------------------------------------------------------------
// One card in the chip's list
// -----------------------------------------------------------------------------
function DeskCard({ card, onAction }) {
  const [busy, setBusy] = useState(false);

  const ctaLabel = {
    review: "Review →",
    respond: "Respond",
    chase: "Chase",
    nudge: "Nudge",
  }[card.cta] || "Open";

  const ctaStyle = {
    review: "bg-brand-ink text-white hover:shadow-brutal-sm",
    respond: "border border-black bg-white hover:bg-brand-red hover:text-white",
    chase: "border border-black bg-white hover:bg-brand-red hover:text-white",
    nudge: "border border-black bg-white hover:bg-brand-yellow",
  }[card.cta] || "border border-black bg-white";

  const doAction = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await onAction(card);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid={`desk-card-${card.id}`}
      className="flex items-center justify-between gap-4 p-4 border border-black bg-white hover:shadow-brutal-sm transition-all"
    >
      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-base leading-tight truncate">{card.title}</p>
        <p className="text-xs text-muted-foreground font-mono mt-1">{card.context_line}</p>
      </div>
      {card.amount_formatted && (
        <p className="font-mono font-bold text-sm shrink-0">{card.amount_formatted}</p>
      )}
      <button
        data-testid={`desk-cta-${card.cta}-${card.id}`}
        onClick={doAction}
        disabled={busy}
        className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider shrink-0 disabled:opacity-50 transition-all ${ctaStyle}`}
      >
        {busy ? <Spinner size={12} className="animate-spin" /> : ctaLabel}
      </button>
    </div>
  );
}


// -----------------------------------------------------------------------------
// Main Desk page
// -----------------------------------------------------------------------------
const CHIPS = [
  { key: "needs_decision", label: "Needs Your Decision", icon: null },
  { key: "on_fire", label: "On Fire", icon: Fire },
  { key: "due_today", label: "Due Today", icon: Sun },
  { key: "important", label: "Important", icon: Star },
];

export default function Desk() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [chip, setChip] = useState("needs_decision");
  const [openDecision, setOpenDecision] = useState(null); // decision id for the DecisionDialog

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["desk", chip],
    queryFn: () => api.get(`/desk?chip=${chip}`).then((r) => r.data),
    refetchInterval: 30000,
  });

  const counters = data?.counters || { needs_decision: 0, on_fire: 0, due_today: 0, important: 0 };
  const cards = data?.cards || [];

  const refresh = () => qc.invalidateQueries({ queryKey: ["desk"] });

  const onCardAction = async (card) => {
    if (card.cta === "review" && card.target_kind === "decision") {
      setOpenDecision(card.target_id);
      return;
    }
    if (card.cta === "respond") {
      // Task-level respond: jump to MyWork with the task focused so the
      // founder can reply from the full task detail (which has the trail
      // + attachments + full context).
      navigate(`/my-work?task=${card.target_id}`);
      return;
    }
    if (card.cta === "chase" || card.cta === "nudge") {
      try {
        const res = await api.post(`/desk/nudge/${card.target_id}`, {});
        const to = res.data?.target_name || "them";
        toast.success(
          card.cta === "chase"
            ? `Chased ${to} — sent via ${res.data?.channel}`
            : `Nudged ${to} — sent via ${res.data?.channel}`
        );
        refresh();
      } catch (e) {
        toast.error(e.response?.data?.detail || "Nudge failed");
      }
    }
  };

  // Header subline copy — matches the founder mock exactly.
  const subline = [
    `${counters.needs_decision} decision${counters.needs_decision !== 1 ? "s" : ""} waiting on you`,
    `${counters.on_fire} on fire`,
    `${counters.due_today} due today`,
  ].join(" · ");

  return (
    <div className="max-w-5xl mx-auto">
      {/* Capture stays at the top (founder confirmation 2026-08-14). */}
      <CaptureBar onCaptured={refresh} />

      {/* Header */}
      <div className="mb-4">
        <h1 className="font-heading text-4xl font-black tracking-tighter" data-testid="desk-title">
          Decision Desk
        </h1>
        <p className="text-sm text-muted-foreground mt-1" data-testid="desk-subline">
          {subline}
        </p>
      </div>

      {/* Chips */}
      <div className="flex flex-wrap gap-2 mb-6" data-testid="desk-chips">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setChip(c.key)}
            data-testid={`desk-chip-${c.key}`}
            className={`flex items-center gap-2 px-4 py-2 border border-black text-sm font-semibold uppercase tracking-wider transition-colors ${
              chip === c.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"
            }`}
          >
            {c.icon && <c.icon size={14} weight="bold" />}
            {c.label}
            <span
              className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold ${
                chip === c.key ? "bg-white/20 text-white" : "bg-black/10 text-black"
              }`}
            >
              {counters[c.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Card list */}
      {isLoading && (
        <p className="font-mono text-sm text-muted-foreground py-8 text-center">Loading…</p>
      )}
      {!isLoading && cards.length === 0 && (
        <div className="border border-black border-dashed bg-white p-10 text-center" data-testid="desk-empty">
          <CheckCircle size={32} weight="bold" className="text-brand-ink mx-auto mb-3" />
          <p className="font-heading font-bold text-lg">Nothing here — you're caught up</p>
          <p className="text-sm text-muted-foreground mt-1">
            {chip === "needs_decision" && "No decisions are waiting on you right now."}
            {chip === "on_fire" && "No escalations, handoffs, or overdue items."}
            {chip === "due_today" && "Nothing you own is due today."}
            {chip === "important" && "Nothing AI-flagged as important right now."}
          </p>
        </div>
      )}
      <div className="space-y-3" data-testid="desk-card-list">
        {cards.map((c) => (
          <DeskCard key={c.id} card={c} onAction={onCardAction} />
        ))}
      </div>

      {/* Refresh spinner */}
      {isFetching && !isLoading && (
        <p className="text-xs text-muted-foreground font-mono mt-4 flex items-center gap-2">
          <ArrowClockwise size={12} className="animate-spin" /> refreshing…
        </p>
      )}

      {/* Decision review modal */}
      {openDecision && (
        <DecisionDialog
          decisionId={openDecision}
          open={!!openDecision}
          onClose={() => { setOpenDecision(null); refresh(); }}
        />
      )}
    </div>
  );
}
