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
        <Icon size={16} weight="bold" className="text-primary-text" />
        <h3 className="font-extrabold tracking-tight text-sm">{title}</h3>
      </div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={typeof it === "string" ? `item-${i}-${it.slice(0, 24)}` : (it.id || `item-${i}-${it.title || ""}`)} className="text-sm flex gap-2"><span className="text-primary-text">›</span>
            <span>{typeof it === "string" ? it : `${it.title}${it.assignee_name ? ` — ${it.assignee_name}` : ""}`}</span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl rounded-md border-2 border-hairline max-h-[85vh] overflow-y-auto" data-testid="meeting-dialog">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tighter pr-6">{m?.title || "Meeting"}</DialogTitle>
          <DialogDescription className="sr-only">Meeting minutes and action items</DialogDescription>
        </DialogHeader>
        {!m || PROCESSING.includes(m.status) ? (
          <p className="text-label text-sm py-6">Processing meeting notes…</p>
        ) : m.status === "failed" ? (
          <p className="text-sm text-primary-text py-6">Could not process this recording. Try again.</p>
        ) : (
          <div>
            {m.summary && <p className="text-sm mb-5 leading-relaxed">{m.summary}</p>}
            <Block icon={Lightbulb} title="Key Points" items={m.key_points} />
            <Block icon={Gavel} title="Decisions" items={m.decisions} />
            <Block icon={ListChecks} title={`Action Items (${(m.action_items || []).length})`} items={m.action_items} />
            {m.transcript && (
              <details className="mt-4 border-t-hairline pt-3">
                <summary className="text-label text-text-secondary cursor-pointer">Full transcript</summary>
                <p className="text-sm mt-2 whitespace-pre-wrap text-text-secondary">{m.transcript}</p>
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

      <div className="rounded-lg border border-hairline bg-surface p-8 mb-8 flex flex-col items-center text-center" data-testid="meeting-recorder">
        <button
          onClick={recording ? stopRec : startRec}
          disabled={busy}
          data-testid="meeting-record-button"
          className={`w-24 h-24 flex items-center justify-center border border-hairline transition-all ${recording ? "bg-primary text-primary-foreground recording-pulse" : "bg-primary text-primary-foreground hover:shadow-sm"} rounded-md`}
        >
          {recording ? <Stop size={38} weight="fill" /> : <Microphone size={38} weight="fill" />}
        </button>
        <p className="mt-4 font-bold tracking-tight">
          {recording ? "Recording…" : busy ? "Uploading…" : "Tap to record a meeting"}
        </p>
        <p className="text-label text-sm text-text-secondary mt-1">AI transcribes & extracts action items</p>
        <button onClick={() => setShowText((s) => !s)} data-testid="meeting-paste-toggle"
          className="mt-5 flex items-center gap-2 text-sm font-semibold border border-hairline px-4 py-2 hover:bg-surface-hover transition-colors rounded-md">
          <TextT size={15} weight="bold" /> Paste transcript instead
        </button>
        {showText && (
          <div className="w-full max-w-xl mt-4">
            <textarea data-testid="meeting-text-input" rows={5} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Paste or type the meeting transcript…"
              className="w-full border border-hairline p-3 text-sm text-label focus:outline-none rounded-md" />
            <button onClick={submitText} disabled={busy || !text.trim()} data-testid="meeting-text-submit"
              className="mt-2 w-full py-2.5 text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-50">
              Generate notes
            </button>
          </div>
        )}
      </div>

      <h2 className="text-xl font-extrabold tracking-tight mb-4">Past Meetings</h2>
      {meetings.length === 0 ? (
        <EmptyState title="No meetings yet" hint="Record your first meeting and AI will write the minutes." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="meetings-list">
          {meetings.map((m) => (
            <button key={m.id} onClick={() => setOpenId(m.id)} data-testid={`meeting-card-${m.id}`}
              className="rounded-lg border border-hairline bg-surface p-4 text-left shadow-hover">
              <div className="flex items-center justify-between gap-2 mb-2">
                <FileText size={18} weight="bold" className="text-primary-text" />
                {PROCESSING.includes(m.status) ? <Chip value="processing" className="text-text" /> : <Chip value={m.status} />}
              </div>
              <p className="text-sm font-semibold leading-tight">{m.title}</p>
              {m.summary && <p className="text-xs text-text-secondary mt-1 line-clamp-2">{m.summary}</p>}
              <p className="text-label text-text-secondary mt-2 flex items-center gap-1">
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
