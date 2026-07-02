import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { toast } from "sonner";
import { CheckCircle, Camera, Microphone, Stop, ChatCircleText } from "@phosphor-icons/react";

function TaskCard({ t, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const upload = async (file, kind) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file, file.name || `${kind}.dat`);
    fd.append("kind", kind);
    try {
      await api.post(`/tasks/${t.id}/attachment`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${kind === "photo" ? "Photo" : "Voice reply"} added`);
      onChange();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onPhoto = (e) => {
    const f = e.target.files?.[0];
    if (f) upload(f, "photo");
  };

  const toggleVoice = async () => {
    if (recording) {
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((x) => x.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        upload(new File([blob], "voice.webm"), "voice");
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      toast.error("Mic access denied");
    }
  };

  const complete = async () => {
    await api.patch(`/tasks/${t.id}`, { status: "done" });
    toast.success("Task completed");
    onChange();
  };

  return (
    <div data-testid={`mywork-task-${t.id}`} className="card-brutal p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading font-bold text-lg leading-tight">{t.title}</p>
        <Chip value={t.priority} />
      </div>
      {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
      <div className="flex items-center gap-1.5 mt-3">
        <Chip value={t.status} />
        {t.due_date && <span className="text-xs text-muted-foreground">due {new Date(t.due_date).toLocaleDateString()}</span>}
      </div>

      {(t.attachments || []).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {t.attachments.map((a, i) => (
            a.kind === "photo"
              ? <img key={i} src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} alt="proof" className="w-16 h-16 object-cover border border-black" data-testid={`att-photo-${t.id}-${i}`} />
              : <audio key={i} controls src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} className="h-8" data-testid={`att-voice-${t.id}-${i}`} />
          ))}
        </div>
      )}

      {t.status !== "done" && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={complete} data-testid={`complete-${t.id}`} className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            <CheckCircle size={16} weight="bold" /> Complete
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid={`photo-${t.id}`} className="flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-black/5">
            <Camera size={16} weight="bold" /> Photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
          <button onClick={toggleVoice} data-testid={`voice-${t.id}`} className={`flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${recording ? "bg-brand-red text-white" : "hover:bg-black/5"}`}>
            {recording ? <Stop size={16} weight="fill" /> : <Microphone size={16} weight="bold" />} {recording ? "Stop" : "Voice reply"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function MyWork() {
  const qc = useQueryClient();
  const tasksQ = useQuery({ queryKey: ["tasks", true], queryFn: () => api.get("/tasks?mine=true").then((r) => r.data) });
  const notifQ = useQuery({ queryKey: ["notifications"], queryFn: () => api.get("/notifications").then((r) => r.data) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks", true] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const open = (tasksQ.data || []).filter((t) => t.status !== "done");
  const done = (tasksQ.data || []).filter((t) => t.status === "done");

  return (
    <div>
      <PageHeader eyebrow="Your day, simplified" title="My Work" />

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4">My Tasks</h2>
          {open.length === 0 && <EmptyState title="Nothing pending" hint="You're all caught up!" />}
          <div className="space-y-4">
            {open.map((t) => <TaskCard key={t.id} t={t} onChange={refresh} />)}
          </div>
          {done.length > 0 && (
            <>
              <h3 className="font-heading font-extrabold uppercase tracking-tight text-lg mt-8 mb-3 text-muted-foreground">Completed</h3>
              <div className="space-y-3">
                {done.map((t) => <TaskCard key={t.id} t={t} onChange={refresh} />)}
              </div>
            </>
          )}
        </div>

        <div>
          <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4 flex items-center gap-2">
            <ChatCircleText size={22} weight="bold" /> Messages
          </h2>
          <div className="card-brutal divide-y divide-black/10" data-testid="mywork-messages">
            {(notifQ.data?.notifications || []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No messages.</p>}
            {(notifQ.data?.notifications || []).slice(0, 15).map((n) => (
              <div key={n.id} className="p-4">
                <p className="text-sm">{n.message}</p>
                <Chip value={n.level} className="mt-2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
