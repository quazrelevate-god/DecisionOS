/*
 * Chatbot — the single chat surface for every authenticated user.
 *
 * All authorization happens server-side (routers/chatbot.py). This UI is
 * purely a renderer: it never decides who can ask what. Never accepts or
 * sends a `user_id` to the backend — the backend derives the user from the
 * auth cookie.
 *
 * Response types handled: ANSWER, PERMISSION_DENIED, IRRELEVANT,
 * INJECTION_REFUSED, INSUFFICIENT_DATA, ERROR.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  PaperPlaneTilt, Lock, Sparkle, WarningCircle, Broom, Trash, PencilSimple,
  ShieldWarning, Chat, Plus, ArrowRight, User as UserIcon,
} from "@phosphor-icons/react";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { MicDictateButton } from "../components/MicDictateButton";
import { KpiGrid, DataTable, Sources } from "../components/BrainResults";

const SUGGESTIONS = [
  "What should I focus on today?",
  "Show me my pending tasks",
  "What decisions are waiting for approval?",
  "What does our leave policy say?",
];

function AssistantMessage({ m, onGo, onAsk, currency }) {
  const t = m.resp?.type;
  const answer = m.resp?.answer || m.content || "";

  if (t === "PERMISSION_DENIED") {
    return (
      <div className="card-brutal p-4 border-l-4 border-l-brand-red" data-testid="chatbot-permission-denied">
        <p className="flex items-center gap-2 font-semibold text-sm"><Lock size={16} weight="bold" className="text-brand-red" /> Restricted</p>
        <p className="text-sm text-muted-foreground mt-1">{answer}</p>
      </div>
    );
  }
  if (t === "IRRELEVANT") {
    return (
      <div className="card-brutal p-4 border-l-4 border-l-amber-500" data-testid="chatbot-irrelevant">
        <p className="flex items-center gap-2 font-semibold text-sm"><WarningCircle size={16} weight="bold" className="text-amber-500" /> Off-topic</p>
        <p className="text-sm text-muted-foreground mt-1">{answer}</p>
      </div>
    );
  }
  if (t === "INJECTION_REFUSED") {
    return (
      <div className="card-brutal p-4 border-l-4 border-l-brand-red" data-testid="chatbot-injection">
        <p className="flex items-center gap-2 font-semibold text-sm"><ShieldWarning size={16} weight="bold" className="text-brand-red" /> Blocked</p>
        <p className="text-sm text-muted-foreground mt-1">{answer}</p>
      </div>
    );
  }
  if (t === "INSUFFICIENT_DATA") {
    return (
      <div className="card-brutal p-4 border-l-4 border-l-amber-500" data-testid="chatbot-insufficient">
        <p className="flex items-center gap-2 font-semibold text-sm"><WarningCircle size={16} weight="bold" className="text-amber-500" /> Not enough information</p>
        <p className="text-sm text-muted-foreground mt-1">{answer}</p>
        {(m.resp?.suggested_questions || []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.resp.suggested_questions.map((s, i) => (
              <button key={`${s}-${i}`} onClick={() => onAsk(s)}
                className="inline-flex items-center gap-1 text-xs border border-black/40 px-2.5 py-1 rounded-full hover:bg-brand-ink hover:text-white transition-colors">
                {s} <ArrowRight size={12} weight="bold" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (t === "ERROR") {
    return (
      <div className="card-brutal p-4 border-l-4 border-l-brand-red" data-testid="chatbot-error">
        <p className="text-sm text-muted-foreground">{answer}</p>
      </div>
    );
  }
  const r = m.resp || {};
  return (
    <div className="space-y-1" data-testid="chatbot-answer">
      {answer && <div className="text-sm leading-relaxed whitespace-pre-wrap mb-3">{answer}</div>}
      <KpiGrid kpis={r.kpis} currency={currency} />
      <DataTable table={r.table} currency={currency} />
      <Sources sources={r.sources} onGo={onGo} />
      {(r.suggested_questions || []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.suggested_questions.map((s, i) => (
            <button key={`${s}-${i}`} onClick={() => onAsk(s)}
              className="inline-flex items-center gap-1 text-xs border border-black/40 px-2.5 py-1 rounded-full hover:bg-brand-ink hover:text-white transition-colors">
              {s} <ArrowRight size={12} weight="bold" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Chatbot() {
  const { user, tenant } = useAuth();
  const navigate = useNavigate();
  const currency = tenant?.currency || "INR";

  const [convs, setConvs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [msgs, setMsgs] = useState([]); // [{role, content, resp?}]
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);

  const loadConvs = async () => {
    try {
      const { data } = await api.get("/chatbot/conversations");
      setConvs(data || []);
    } catch (e) {
      // Silent — a fresh user has no conversations yet
    }
  };

  useEffect(() => { loadConvs(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length, busy]);

  const openConv = async (id) => {
    if (!id) { setActiveId(null); setMsgs([]); return; }
    try {
      const { data } = await api.get(`/chatbot/conversations/${id}`);
      setActiveId(id);
      // Server returns messages oldest→newest per chatbot_memory.load_recent_messages
      setMsgs((data.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
        resp: m.role === "assistant" ? {
          type: m.response_type || "ANSWER",
          answer: m.content,
          kpis: m.kpis || [],
          table: m.table || null,
          sources: m.sources || [],
          suggested_questions: [],
        } : undefined,
      })));
    } catch (e) {
      if (e?.response?.status === 404) {
        toast.error("That conversation isn't available");
        setActiveId(null); setMsgs([]); loadConvs();
      } else {
        toast.error("Couldn't load conversation");
      }
    }
  };

  const newConv = () => { setActiveId(null); setMsgs([]); };

  const send = async (overrideText) => {
    const text = ((typeof overrideText === "string" ? overrideText : input) || "").trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const body = { message: text };
      if (activeId) body.conversation_id = activeId;
      const { data } = await api.post("/chatbot/message", body);
      // Server always returns conversation_id (fresh or existing)
      if (!activeId && data.conversation_id) setActiveId(data.conversation_id);
      setMsgs((m) => [...m, { role: "assistant", content: data.answer || "", resp: data }]);
      if (data.conversation_id) loadConvs(); // refresh sidebar (title/updated_at)
    } catch (e) {
      // Never surface stack traces or raw backend errors
      const detail = e?.response?.data?.detail;
      const msg = typeof detail === "string" ? detail : "Something went wrong. Please try again.";
      setMsgs((m) => [...m, { role: "assistant", content: msg, resp: { type: "ERROR", answer: msg } }]);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this conversation?")) return;
    try {
      await api.delete(`/chatbot/conversations/${id}`);
      if (activeId === id) newConv();
      loadConvs();
    } catch { toast.error("Couldn't delete"); }
  };

  const rename = async (id, oldTitle) => {
    const title = window.prompt("Rename conversation", oldTitle || "");
    if (!title) return;
    try {
      await api.post(`/chatbot/conversations/${id}/rename`, { title });
      loadConvs();
    } catch { toast.error("Couldn't rename"); }
  };

  const roleBadge = (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 border border-black text-[10px] uppercase tracking-wider font-semibold">
      <UserIcon size={11} weight="bold" /> {user?.role || "user"}
    </span>
  );

  return (
    <div className="flex h-[calc(100vh-64px)]" data-testid="chatbot-page">
      {/* Sidebar — the caller's own conversations */}
      <aside className="w-64 border-r border-black/10 bg-white overflow-y-auto shrink-0">
        <div className="p-3 border-b border-black/10 flex items-center justify-between">
          <p className="label-mono text-muted-foreground">Chats</p>
          <button onClick={newConv} className="text-xs border border-black px-2 py-1 hover:bg-brand-ink hover:text-white transition-colors flex items-center gap-1" data-testid="chatbot-new">
            <Plus size={12} weight="bold" /> New
          </button>
        </div>
        <ul>
          {convs.length === 0 && (
            <li className="p-3 text-xs text-muted-foreground">No conversations yet.</li>
          )}
          {convs.map((c) => (
            <li key={c.id} className={`group flex items-center justify-between px-3 py-2 border-b border-black/5 cursor-pointer hover:bg-brand-paper ${activeId === c.id ? "bg-brand-paper" : ""}`}
                data-testid={`chatbot-conv-${c.id}`}>
              <button onClick={() => openConv(c.id)} className="flex-1 text-left truncate text-sm">{c.title}</button>
              <span className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                <button onClick={() => rename(c.id, c.title)} className="p-1 text-muted-foreground hover:text-brand-ink" title="Rename"><PencilSimple size={12} /></button>
                <button onClick={() => remove(c.id)} className="p-1 text-muted-foreground hover:text-brand-red" title="Delete"><Trash size={12} /></button>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* Main — thread + composer */}
      <div className="flex-1 flex flex-col">
        <header className="px-6 py-3 border-b border-black/10 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2">
            <Chat size={18} weight="bold" className="text-brand-red" />
            <p className="font-heading font-black uppercase tracking-tight">DecisionOS Chatbot</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Signed in as</span>
            <span className="font-semibold">{user?.name || "—"}</span>
            {roleBadge}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4" data-testid="chatbot-thread">
          {msgs.length === 0 && (
            <div className="max-w-lg mx-auto text-center mt-8" data-testid="chatbot-empty">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-black bg-brand-yellow/40 text-xs font-mono mb-4">
                <Sparkle size={13} weight="bold" /> Answers come from data your role can access
              </div>
              <p className="font-heading text-2xl font-black uppercase tracking-tighter mb-2">Ask about your company.</p>
              <p className="text-sm text-muted-foreground mb-6">Tasks, decisions, workflows, documents — the chatbot only returns what your role is permitted to see.</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="text-xs border border-black px-3 py-1.5 hover:bg-brand-ink hover:text-white transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""} data-testid={`chatbot-msg-${i}`}>
              <div className={m.role === "user"
                ? "max-w-[70%] bg-brand-ink text-white text-sm px-4 py-2 border border-black"
                : "max-w-[85%] w-full"}>
                {m.role === "user" ? m.content :
                  <AssistantMessage m={m} onGo={(link) => link && navigate(link)} onAsk={send} currency={currency} />}
              </div>
            </div>
          ))}
          {busy && (
            <div data-testid="chatbot-thinking">
              <div className="max-w-[85%] card-brutal p-3 text-sm text-muted-foreground animate-pulse">Thinking…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-black/10 bg-white p-3">
          <div className="flex items-end gap-2">
            <textarea
              rows={2}
              disabled={busy}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about your company — tasks, decisions, workflows, policies…"
              className="flex-1 border border-black bg-white px-3 py-2 text-sm focus:outline-none resize-none"
              data-testid="chatbot-input"
            />
            <MicDictateButton onText={(t) => setInput((v) => (v ? `${v} ${t}` : t))} />
            <button onClick={() => send()} disabled={!input.trim() || busy} data-testid="chatbot-send"
              className="bg-brand-ink text-white px-4 py-2 border border-black text-xs font-semibold uppercase tracking-wider hover:shadow-brutal-sm transition-all disabled:opacity-40">
              <PaperPlaneTilt size={14} weight="bold" />
            </button>
            <button onClick={newConv} title="New chat"
              className="border border-black bg-white px-3 py-2 hover:bg-brand-ink hover:text-white transition-colors">
              <Broom size={14} weight="bold" />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground font-mono mt-1.5 text-center">
            Guarded · role-aware · your conversations stay private to your account
          </p>
        </div>
      </div>
    </div>
  );
}
