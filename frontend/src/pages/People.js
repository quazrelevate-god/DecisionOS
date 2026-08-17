import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { hasPerm } from "../lib/perms";
import { lex } from "../lib/lexicon";
import { PageHeader } from "../components/common";
import { UsersThree, AddressBook, Truck, Eye, PencilSimple, Info } from "@phosphor-icons/react";
import api from "../lib/api";
import { TeamPanel } from "./Team";
import { ContactsPanel } from "./Contacts";

// U7-09.PEOPLE (2026-08-17): revived + rethought.
// Founder ask: 'people section can be show to all the people but as view
// and owner and given access to people only has the edit section, other
// will have the view section .. it will be shown as based, now lets work
// on the UI part as well'.
//
// Design:
//  - All 3 tabs (Employees / Customers / Vendors) are visible to every
//    authenticated user. No perm gate on the tab strip.
//  - Edit affordances per-tab are gated separately:
//      Employees  -> team_manage OR owner
//      Customers  -> people OR owner
//      Vendors    -> people OR owner
//  - A view-mode banner appears at the top when the current viewer
//    cannot edit the currently-active tab, coaching them to ask the
//    owner for access.
//  - Tab strip shows a count badge per tab, sourced from the same
//    endpoints the panels already query -- no extra backend work.

const CUSTOMER_TYPES = ["customer", "dealer"];
const VENDOR_TYPES = ["vendor"];

export default function People() {
  const { user, tenant } = useAuth();
  const { t } = useTranslation();
  const L = lex(tenant);
  const isOwner = user?.role === "owner";
  const canEditTeam = isOwner || hasPerm(user, "team_manage");
  const canEditPeople = isOwner || hasPerm(user, "people");

  const [tab, setTab] = useState("employees");

  // Counts for the tab badges. Same endpoints the panels use; React Query
  // dedupes so this doesn't cost an extra network round trip.
  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
  });
  const contactsQ = useQuery({
    queryKey: ["contacts", "", ""],
    queryFn: () => api.get("/contacts?type=&status=&q=").then((r) => r.data),
  });
  const counts = useMemo(() => ({
    employees: (usersQ.data || []).length,
    customers: (contactsQ.data || []).filter((c) => CUSTOMER_TYPES.includes(c.type)).length,
    vendors: (contactsQ.data || []).filter((c) => VENDOR_TYPES.includes(c.type)).length,
  }), [usersQ.data, contactsQ.data]);

  const TABS = [
    { key: "employees", label: t("people.employees"), icon: UsersThree, canEdit: canEditTeam },
    { key: "customers", label: L.customer_plural, icon: AddressBook, canEdit: canEditPeople },
    { key: "vendors", label: L.vendor_plural, icon: Truck, canEdit: canEditPeople },
  ];

  const activeTab = TABS.find((tb) => tb.key === tab) || TABS[0];
  const showViewBanner = !activeTab.canEdit;

  return (
    <div>
      <PageHeader
        eyebrow={t("people.eyebrow", { customers: L.customer_plural.toLowerCase(), vendors: L.vendor_plural.toLowerCase() })}
        title={t("people.title")}
      >
        <div className="flex border border-black" data-testid="people-tabs">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              data-testid={`people-tab-${tb.key}`}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border-r border-black last:border-r-0 transition-colors ${tab === tb.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}
            >
              <tb.icon size={16} weight="bold" />
              {tb.label}
              {counts[tb.key] > 0 && (
                <span className={`label-mono min-w-5 h-5 px-1 flex items-center justify-center border ${tab === tb.key ? "border-white/40 text-white/80" : "border-black/20 text-muted-foreground"}`}>
                  {counts[tb.key]}
                </span>
              )}
              {!tb.canEdit && (
                <Eye
                  size={12}
                  weight="bold"
                  className={tab === tb.key ? "text-white/60" : "text-muted-foreground"}
                  aria-label="View only"
                />
              )}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* View-mode banner. Softer treatment -- doesn't scold, just tells
          the user what they're seeing and what the escape hatch is. */}
      {showViewBanner && (
        <div
          className="mb-4 border border-black/30 bg-black/[0.02] px-4 py-2.5 flex items-center gap-3 flex-wrap"
          data-testid="people-view-mode-banner"
        >
          <Info size={16} weight="bold" className="text-brand-600 shrink-0" />
          <p className="text-sm flex-1 min-w-0">
            You're viewing <strong>{activeTab.label}</strong> — read-only. Ask an owner for
            <span className="label-mono text-muted-foreground ml-1">
              {tab === "employees" ? "team_manage" : "people"}
            </span> access to edit.
          </p>
          <span className="hidden sm:inline-flex items-center gap-1 label-mono text-muted-foreground">
            <PencilSimple size={12} weight="bold" /> owner + granted users can edit
          </span>
        </div>
      )}

      {tab === "employees" && <TeamPanel readOnly={!canEditTeam} />}
      {tab === "customers" && (
        <ContactsPanel
          types={CUSTOMER_TYPES}
          addLabel={t("people.add", { name: L.customer_singular })}
          readOnly={!canEditPeople}
        />
      )}
      {tab === "vendors" && (
        <ContactsPanel
          types={VENDOR_TYPES}
          addLabel={t("people.add", { name: L.vendor_singular })}
          readOnly={!canEditPeople}
        />
      )}
    </div>
  );
}
