import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { toast } from "sonner";
import { PageHeader, Chip, EmptyState } from "../components/common";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "../components/ui/dialog";
import { Microphone, Stop, TextT, ListChecks, Lightbulb, Gavel, FileText, ClockCounterClockwise } from "@phosphor-icons/react";

const PROCESSING = ["queued", "transcribing", "structuring"];

function MeetingDialog({ id, open, onClose }) {
  const { data } = useQuery({
    queryKey: ["meeting", id],
    queryFn: () => api.get(`/meetings/${id}`).then((r) => r.data),
    enabled: !!id && open,
    refetchInterval: (q) => (PROCESSING.includes(q.state.data?.status) ? 2500 : false),
  });
  const m = data;
  const Block = ({ icon: Icon, title, items }) => (items || []).length ? (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} weight="bold" className="text-brand-red" />
        <h3 className="font-heading font-extrabold uppercase tracking-tight text-sm">{title}</h3>
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-sm flex gap-2"><span className="text-brand-red">›</span>
            <span>{typeof it === "string" ? it : `${it.title}${it.assignee_name ? ` — ${it.assignee_name}` : ""}`}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-none border-2 border-black max-h-[85vh] overflow-y-auto" data-testid="meeting-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-black uppercase tracking-tighter pr-6">{m?.title || "Meeting"}</DialogTitle>
          <DialogDescription className="sr-only">Meeting minutes and action items</DialogDescription>
        </DialogHeader>
        {!m || PROCESSING.includes(m.status) ? (
          <p className="font-mono text-sm py-6">Processing meeting notes…</p>
        ) : m.status === "failed" ? (
          <p className="text-sm text-brand-red py-6">Could not process this recording. Try again.</p>
        ) : (
          <div>
            {m.summary && <p className="text-sm mb-5 leading-relaxed">{m.summary}</p>}
            <Block icon={Lightbulb} title="Key Points" items={m.key_points} />
            <Block icon={Gavel} title="Decisions" items={m.decisions} />
            <Block icon={ListChecks} title={`Action Items (${(m.action_items || []).length})`} items={m.action_items} />
            {m.transcript && (
              <details className="mt-4 border-t border-black/10 pt-3">
                <summary className="label-mono text-muted-foreground cursor-pointer">Full transcript</summary>
                <p className="text-sm mt-2 whitespace-pre-wrap text-muted-foreground">{m.transcript}</p>
              </details>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Meetings() {
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showText, setShowText] = useState(false);
  const [text, setText] = useState("");
  const [openId, setOpenId] = useState(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const { data } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.get("/meetings").then((r) => r.data),
    refetchInterval: (q) => ((q.state.data || []).some((m) => PROCESSING.includes(m.status)) ? 2500 : false),
  });
  const meetings = data || [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["meetings"] });

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
        fd.append("file", blob, "meeting.webm");
        fd.append("language", "auto");
        setBusy(true);
        try {
          await api.post("/meetings", fd, { headers: { "Content-Type": "multipart/form-data" } });
          toast.success("Recording uploaded — generating notes…");
          refresh();
        } catch { toast.error("Upload failed"); } finally { setBusy(false); }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch { toast.error("Microphone access denied"); }
  };
  const stopRec = () => { mediaRef.current?.stop(); setRecording(false); };

  const submitText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post("/meetings/text", { text });
      setText(""); setShowText(false);
      toast.success("Transcript submitted — generating notes…");
      refresh();
    } catch { toast.error("Submit failed"); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader eyebrow="Record it. AI writes the minutes." title="Meeting Notes" />

      <div className="card-brutal p-8 mb-8 flex flex-col items-center text-center" data-testid="meeting-recorder">
        <button
          onClick={recording ? stopRec : startRec}
          disabled={busy}
          data-testid="meeting-record-button"
          className={`w-24 h-24 flex items-center justify-center border border-black transition-all ${recording ? "bg-brand-red text-white recording-pulse" : "bg-brand-ink text-white hover:shadow-brutal"}`}
        >
          {recording ? <Stop size={38} weight="fill" /> : <Microphone size={38} weight="fill" />}
        </button>
        <p className="mt-4 font-heading font-bold uppercase tracking-tight">
          {recording ? "Recording…" : busy ? "Uploading…" : "Tap to record a meeting"}
        </p>
        <p className="font-mono text-sm text-muted-foreground mt-1">AI transcribes & extracts action items</p>
        <button onClick={() => setShowText((s) => !s)} data-testid="meeting-paste-toggle"
          className="mt-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider border border-black px-4 py-2 hover:bg-brand-ink hover:text-white transition-colors">
          <TextT size={15} weight="bold" /> Paste transcript instead
        </button>
        {showText && (
          <div className="w-full max-w-xl mt-4">
            <textarea data-testid="meeting-text-input" rows={5} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Paste or type the meeting transcript…"
              className="w-full border border-black p-3 text-sm font-mono focus:outline-none" />
            <button onClick={submitText} disabled={busy || !text.trim()} data-testid="meeting-text-submit"
              className="mt-2 w-full py-2.5 text-sm font-semibold uppercase tracking-wider bg-brand-ink text-white hover:bg-brand-red transition-colors disabled:opacity-50">
              Generate notes
            </button>
          </div>
        )}
      </div>

      <h2 className="font-heading text-xl font-extrabold uppercase tracking-tight mb-4">Past Meetings</h2>
      {meetings.length === 0 ? (
        <EmptyState title="No meetings yet" hint="Record your first meeting and AI will write the minutes." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="meetings-list">
          {meetings.map((m) => (
            <button key={m.id} onClick={() => setOpenId(m.id)} data-testid={`meeting-card-${m.id}`}
              className="card-brutal p-4 text-left shadow-hover">
              <div className="flex items-center justify-between gap-2 mb-2">
                <FileText size={18} weight="bold" className="text-brand-red" />
                {PROCESSING.includes(m.status) ? <Chip value="processing" className="bg-brand-yellow text-black" /> : <Chip value={m.status} />}
              </div>
              <p className="text-sm font-semibold leading-tight">{m.title}</p>
              {m.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{m.summary}</p>}
              <p className="label-mono text-muted-foreground mt-2 flex items-center gap-1">
                <ClockCounterClockwise size={12} weight="bold" />
                {(m.created_by_name || "")}{" · "}{(m.created_at || "").slice(0, 10)}
                {(m.action_items || []).length > 0 && ` · ${m.action_items.length} action item(s)`}
              </p>
            </button>
          ))}
        </div>
      )}

      <MeetingDialog id={openId} open={!!openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
