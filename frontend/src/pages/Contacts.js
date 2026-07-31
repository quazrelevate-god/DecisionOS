import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { Chip, EmptyState } from "../components/common";
import { typeLabel } from "../lib/format";
import { toast } from "sonner";
import { Plus, MagnifyingGlass, PencilSimple, Trash, Phone, EnvelopeSimple, MapPin, Warning, Eye } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";

const TYPES = ["customer", "dealer", "vendor"];
const STATUSES = ["lead", "active", "inactive"];
const inp = "w-full border border-hairline px-3 py-2 text-sm text-label focus:outline-none focus:shadow-xs";

function ComplaintDialog({ contact, onSaved }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState("medium");
  const save = async () => {
    if (!text.trim()) return toast.error("Describe the complaint");
    try {
      await api.post("/complaints", { customer_id: contact.id, text, severity });
      toast.success("Complaint logged");
      setText(""); setOpen(false); onSaved && onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-testid={`log-complaint-${contact.id}`} className="w-8 h-8 flex items-center justify-center border border-hairline hover:bg-purple-600 hover:text-white transition-colors rounded-md"><Warning size={14} weight="bold" /></button>
      </DialogTrigger>
      <DialogContent className="border border-hairline rounded-md">
        <DialogHeader><DialogTitle className="tracking-tight">Log complaint — {contact.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <textarea data-testid="complaint-text-input" className={inp} rows={3} placeholder="What went wrong?" value={text} onChange={(e) => setText(e.target.value)} />
          <select className={inp} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {["low", "medium", "high"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <DialogFooter>
          <button data-testid="complaint-save-button" onClick={save} className="bg-purple-600 text-white px-5 py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">Log complaint</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({ trigger, initial, onSaved, users, defaultType }) {
  const [open, setOpen] = useState(false);
  const blank = { type: defaultType || "customer", name: "", company: "", phone: "", email: "", address: "", tax_id: "", tags: "", status: "lead", assigned_id: "", notes: "", birthday: "" };
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const openChange = (o) => {
    setOpen(o);
    if (o) {
      setForm(initial
        ? { ...initial, tags: (initial.tags || []).join(", "), assigned_id: initial.assigned_id || "", company: initial.company || "", phone: initial.phone || "", email: initial.email || "", address: initial.address || "", tax_id: initial.tax_id || "", notes: initial.notes || "", birthday: initial.birthday || "" }
        : blank);
    }
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    const payload = {
      type: form.type, name: form.name, company: form.company, phone: form.phone, email: form.email,
      address: form.address, tax_id: form.tax_id, status: form.status,
      assigned_id: form.assigned_id || null, notes: form.notes, birthday: form.birthday,
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    };
    try {
      if (initial) await api.patch(`/contacts/${initial.id}`, payload);
      else await api.post("/contacts", payload);
      toast.success(initial ? "Contact updated" : "Contact added");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="border border-hairline rounded-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="tracking-tight">{initial ? "Edit contact" : "New contact"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <select data-testid="contact-type-select" className={inp} value={form.type} onChange={set("type")}>
              {TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
            </select>
            <select data-testid="contact-status-select" className={inp} value={form.status} onChange={set("status")}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <input data-testid="contact-name-input" className={inp} placeholder="Contact name *" value={form.name} onChange={set("name")} />
          <input data-testid="contact-company-input" className={inp} placeholder="Company" value={form.company} onChange={set("company")} />
          <div className="grid grid-cols-2 gap-3">
            <input data-testid="contact-phone-input" className={inp} placeholder="Phone" value={form.phone} onChange={set("phone")} />
            <input data-testid="contact-email-input" className={inp} placeholder="Email" value={form.email} onChange={set("email")} />
          </div>
          <input className={inp} placeholder="Address" value={form.address} onChange={set("address")} />
          <div className="grid grid-cols-2 gap-3">
            <input className={inp} placeholder="GST / Tax ID" value={form.tax_id} onChange={set("tax_id")} />
            <input className={inp} placeholder="Tags (comma separated)" value={form.tags} onChange={set("tags")} />
          </div>
          <div>
            <label className="text-label text-text-secondary">Birthday (optional)</label>
            <input type="date" data-testid="contact-birthday-input" className={inp} value={form.birthday} onChange={set("birthday")} />
          </div>
          <select data-testid="contact-assigned-select" className={inp} value={form.assigned_id} onChange={set("assigned_id")}>
            <option value="">Assign owner…</option>
            {(users || []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
          <textarea className={inp} rows={2} placeholder="Notes" value={form.notes} onChange={set("notes")} />
        </div>
        <DialogFooter>
          <button data-testid="contact-save-button" onClick={save} className="bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">
            {initial ? "Save changes" : "Add contact"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ContactsPanel({ types, addLabel = "Add Contact" }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const canManage = user?.role === "owner" || user?.role === "sales";
  const can360 = hasPerm(user, "finance");

  const { data } = useQuery({
    queryKey: ["contacts", status, q],
    queryFn: () => api.get(`/contacts?type=&status=${status}&q=${encodeURIComponent(q)}`).then((r) => r.data),
  });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });

  const refresh = () => qc.invalidateQueries({ queryKey: ["contacts"] });
  const contacts = (data || []).filter((c) => types.includes(c.type));

  const remove = async (id) => {
    try {
      await api.delete(`/contacts/${id}`);
      toast.success("Contact deleted");
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
  };

  const selectCls = "border border-hairline bg-surface px-3 py-2 text-sm text-label focus:outline-none";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="flex items-center border border-hairline bg-surface px-3 flex-1 min-w-[200px] rounded-md">
          <MagnifyingGlass size={16} weight="bold" className="text-text-secondary" />
          <input data-testid="contact-search-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, phone, email…" className="flex-1 py-2 px-2 text-sm text-label focus:outline-none" />
        </div>
        <select data-testid="contact-status-filter" value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {canManage && (
          <ContactDialog
            users={users}
            defaultType={types[0]}
            onSaved={refresh}
            trigger={
              <button data-testid="add-contact-button" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold border border-hairline hover:shadow-sm transition-all rounded-md">
                <Plus size={16} weight="bold" /> {addLabel}
              </button>
            }
          />
        )}
      </div>

      {contacts.length === 0 && <EmptyState title="Nobody here yet" hint={canManage ? "Add your first record." : "No records match your filters."} />}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {contacts.map((c) => (
          <div key={c.id} data-testid={`contact-card-${c.id}`} className="rounded-lg border border-hairline bg-surface p-5 shadow-hover">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Chip value={typeLabel(c.type)} className={c.type === "customer" ? "bg-primary text-primary-foreground" : "bg-status-pending-bg text-text"} />
                <Chip value={c.status} className={c.status === "active" ? "bg-primary text-primary-foreground" : c.status === "lead" ? "bg-status-pending-bg text-text" : "bg-surface-sunken text-text"} />
              </div>
              {canManage && (
                <div className="flex gap-1">
                  {can360 && (
                    <button data-testid={`view-profile-${c.id}`} onClick={() => navigate(`/contacts/${c.id}`)} title="360° profile" className="w-8 h-8 flex items-center justify-center border border-hairline hover:bg-primary hover:text-white transition-colors rounded-md"><Eye size={14} weight="bold" /></button>
                  )}
                  {c.type === "customer" && <ComplaintDialog contact={c} onSaved={refresh} />}
                  <ContactDialog
                    users={users} initial={c} onSaved={refresh}
                    trigger={<button data-testid={`edit-contact-${c.id}`} className="w-8 h-8 flex items-center justify-center border border-hairline hover:bg-surface-hover transition-colors rounded-md"><PencilSimple size={14} weight="bold" /></button>}
                  />
                  <button data-testid={`delete-contact-${c.id}`} onClick={() => remove(c.id)} className="w-8 h-8 flex items-center justify-center border border-hairline hover:bg-destructive-tint transition-colors rounded-md"><Trash size={14} weight="bold" /></button>
                </div>
              )}
              {!canManage && can360 && (
                <button data-testid={`view-profile-${c.id}`} onClick={() => navigate(`/contacts/${c.id}`)} title="360° profile" className="w-8 h-8 flex items-center justify-center border border-hairline hover:bg-primary hover:text-white transition-colors rounded-md"><Eye size={14} weight="bold" /></button>
              )}
            </div>
            <p className="font-bold text-lg leading-tight">{c.name}</p>
            {c.company && <p className="text-sm text-text-secondary">{c.company}</p>}
            <div className="mt-3 space-y-1 text-sm">
              {c.phone && <p className="flex items-center gap-2"><Phone size={14} weight="bold" className="text-text-secondary" /> {c.phone}</p>}
              {c.email && <p className="flex items-center gap-2 break-all"><EnvelopeSimple size={14} weight="bold" className="text-text-secondary" /> {c.email}</p>}
              {c.address && <p className="flex items-center gap-2"><MapPin size={14} weight="bold" className="text-text-secondary" /> {c.address}</p>}
            </div>
            {(c.tags || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {c.tags.map((t) => <span key={t} className="text-[10px] border border-hairline px-1.5 py-0.5 rounded-md">{t}</span>)}
              </div>
            )}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-hairline text-xs text-text-secondary">
              <span>{c.assigned_name ? `Owner: ${c.assigned_name}` : "Unassigned"}</span>
              {c.tax_id && <span className="text-label">{c.tax_id}</span>}
            </div>
            {c.notes && <p className="text-xs text-text-secondary mt-2 italic">{c.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
