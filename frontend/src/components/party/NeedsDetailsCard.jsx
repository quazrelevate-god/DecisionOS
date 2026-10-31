import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AddressBook, ArrowRight } from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { canSeeAnyCrm } from "../../lib/perms";
import { GLASS_PILL } from "../neuglass/glass";

/* Epic 11 S12 — the Desk says when Dex or a task added customers or suppliers
   with only a name: "3 new customers/suppliers need details", opening CRM's
   Needs details filter. Shown to the people who hold that side of CRM; nothing
   at all when the list is empty. */
export function NeedsDetailsCard({ className = "" }) {
  const { user } = useAuth();
  const allowed = canSeeAnyCrm(user);
  const q = useQuery({
    queryKey: ["parties-needs-details"],
    queryFn: async () => (await api.get("/parties/needs-details")).data,
    enabled: allowed,
    staleTime: 60_000,
  });
  const n = q.data?.count || 0;
  if (!allowed || !n) return null;
  const names = (q.data.items || []).slice(0, 3).map((c) => c.name).join(", ");
  return (
    <Link to="/crm?needs_details=1" data-testid="needs-details-card"
      className={`flex items-center gap-3 rounded-3xl px-4 py-3 text-left ${GLASS_PILL} ${className}`}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800">
        <AddressBook size={18} weight="bold" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">
          {n === 1 ? "1 new customer/supplier needs details" : `${n} new customers/suppliers need details`}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {names}{n > 3 ? ` and ${n - 3} more` : ""} · add their phone and GST
        </span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-slate-400" aria-hidden="true" />
    </Link>
  );
}
