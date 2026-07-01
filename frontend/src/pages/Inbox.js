import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { toast } from "sonner";
import { Microphone, Stop, PaperPlaneTilt, CheckCircle, XCircle, Spinner } from "@phosphor-icons/react";

const PROCESSING = ["queued", "transcribing", "structuring"];

function useElapsed(active) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return setT(0);
    const i = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [active]);
  return t;
}

export default function Inbox() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const elapsed = useElapsed(recording);

  const notesQ = useQuery({
    queryKey: ["voice-notes"],
    queryFn: () => api.get("/voice-notes").then((r) => r.data),
    refetchInterval: (q) => ((q.state.data || []).some((n) => PROCESSING.includes(n.status)) ? 2500 : false),
  });
  const decisionsQ = useQuery({ queryKey: ["decisions"], queryFn: () => api.get("/decisions").then((r) => r.data) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["voice-notes"] });
    qc.invalidateQueries({ queryKey: ["decisions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "note.webm");
        setBusy(true);
        try {
          await api.post("/voice-notes", fd, { headers: { "Content-Type": "multipart/form-data" } });
          toast.success("Voice note uploaded — processing…");
          refresh();
        } catch {
          toast.error("Upload failed");
        } finally {
          setBusy(false);
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      toast.error("Microphone access denied");
    }
  };

  const stopRec = () => {
    mediaRef.current?.stop();
    setRecording(false);
  };

  const submitText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post("/voice-notes/text", { text });
      setText("");
      toast.success("Directive submitted — structuring…");
      refresh();
    } catch {
      toast.error("Submit failed");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id, action) => {
    try {
      await api.post(`/decisions/${id}/${action}`);
      toast.success(`Decision ${action}d`);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div>
      <PageHeader eyebrow="Voice-first capture" title="Owner Inbox" />

      <div className="grid lg:grid-cols-2 gap-6 mb-10">
        {user?.role !== "owner" && (
          <div className="lg:col-span-2 border border-black bg-brand-yellow/40 p-4 text-sm" data-testid="owner-only-notice">
            Only the <strong>owner</strong> can record or type directives. You can review extracted decisions and their tasks below.
          </div>
        )}
        {user?.role === "owner" && (<>
        {/* Recorder */}
        <div className="card-brutal p-8 flex flex-col items-center justify-center text-center">
          <button
            onClick={recording ? stopRec : startRec}
            disabled={busy}
            data-testid="voice-record-button"
            className={`w-28 h-28 flex items-center justify-center border border-black transition-all ${
              recording ? "bg-brand-red text-white recording-pulse" : "bg-brand-ink text-white hover:shadow-brutal"
            }`}
          >
            {recording ? <Stop size={44} weight="fill" /> : <Microphone size={44} weight="fill" />}
          </button>
          <p className="mt-6 font-heading font-bold uppercase tracking-tight text-lg">
            {recording ? "Recording…" : busy ? "Uploading…" : "Tap to record a decision"}
          </p>
          <p className="font-mono text-sm text-muted-foreground mt-1" data-testid="record-timer">
            {recording ? mmss : "Speak your directive; AI structures it."}
          </p>
        </div>

        {/* Text fallback */}
        <div className="card-brutal p-6">
          <p className="label-mono text-muted-foreground mb-3">Type a directive (fallback)</p>
          <textarea
            data-testid="text-directive-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="e.g. Tell sales to send the revised quote to the Delhi retailer by Friday and ask finance to clear the packaging invoice."
            className="w-full border border-black p-3 text-sm font-mono focus:outline-none focus:shadow-brutal-sm transition-shadow resize-none"
          />
          <button
            onClick={submitText}
            disabled={busy || !text.trim()}
            data-testid="submit-text-directive"
            className="mt-3 flex items-center gap-2 bg-brand-red text-white px-5 py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all disabled:opacity-50"
          >
            <PaperPlaneTilt size={16} weight="bold" /> Structure it
          </button>
        </div>
        </>)}
      </div>

      {/* Processing feed */}
      <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4">Processing Feed</h2>
      <div className="card-brutal divide-y divide-black/10 mb-10">
        {(notesQ.data || []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No voice notes yet.</p>}
        {(notesQ.data || []).map((n) => (
          <div key={n.id} data-testid={`voice-note-${n.id}`} className="p-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm truncate">{n.transcript || <span className="text-muted-foreground italic">Awaiting transcription…</span>}</p>
              <p className="label-mono text-muted-foreground mt-1">{n.kind}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {PROCESSING.includes(n.status) && <Spinner size={16} className="animate-spin" />}
              <Chip value={n.status} data-testid={`voice-note-status-${n.id}`} />
            </div>
          </div>
        ))}
      </div>

      {/* Extracted decisions */}
      <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4">Extracted Decisions</h2>
      <div className="grid md:grid-cols-2 gap-4">
        {(decisionsQ.data || []).length === 0 && <EmptyState title="No decisions extracted yet" hint="Record or type a directive above." />}
        {(decisionsQ.data || []).map((d) => (
          <div key={d.id} data-testid={`decision-card-${d.id}`} className="card-brutal p-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <Chip value={d.status} data-testid={`decision-status-${d.id}`} />
              <span className="label-mono text-muted-foreground">{d.created_by_name}</span>
            </div>
            <p className="font-heading font-bold text-lg leading-tight">{d.title}</p>
            <p className="text-sm text-muted-foreground mt-2">{d.summary}</p>
            {d.tasks?.length > 0 && (
              <ul className="mt-4 space-y-2">
                {d.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 border border-black/15 px-3 py-2">
                    <span className="text-sm">{t.title}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {t.assignee_role && <Chip value={t.assignee_role} className="bg-white" />}
                      <Chip value={t.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {user?.role === "owner" && d.status === "pending_approval" && (
              <div className="flex gap-2 mt-4">
                <button onClick={() => decide(d.id, "approve")} data-testid={`inbox-approve-${d.id}`}
                  className="flex-1 flex items-center justify-center gap-2 bg-brand-blue text-white py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
                  <CheckCircle size={16} weight="bold" /> Approve
                </button>
                <button onClick={() => decide(d.id, "reject")} data-testid={`inbox-reject-${d.id}`}
                  className="flex items-center gap-2 bg-white py-2 px-4 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-ink hover:text-white transition-colors">
                  <XCircle size={16} weight="bold" /> Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
