import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { hasPerm } from "../lib/perms";
import { lex } from "../lib/lexicon";
import { PageHeader } from "../components/common";
import { UsersThree, AddressBook, Truck } from "@phosphor-icons/react";
import { TeamPanel } from "./Team";
import { ContactsPanel } from "./Contacts";

const CUSTOMER_TYPES = ["customer", "dealer"];
const VENDOR_TYPES = ["vendor"];

export default function People() {
  const { user, tenant } = useAuth();
  const { t } = useTranslation();
  const L = lex(tenant);
  const canTeam = hasPerm(user, "team_manage");
  const [tab, setTab] = useState(canTeam ? "employees" : "customers");

  const TABS = [
    ...(canTeam ? [{ key: "employees", label: t("people.employees"), icon: UsersThree }] : []),
    { key: "customers", label: L.customer_plural, icon: AddressBook },
    { key: "vendors", label: L.vendor_plural, icon: Truck },
  ];

  return (
    <div>
      <PageHeader eyebrow={t("people.eyebrow", { customers: L.customer_plural.toLowerCase(), vendors: L.vendor_plural.toLowerCase() })} title={t("people.title")}>
        <div className="flex border border-black" data-testid="people-tabs">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} data-testid={`people-tab-${t.key}`}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border-r border-black last:border-r-0 transition-colors ${tab === t.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
              <t.icon size={16} weight="bold" /> {t.label}
            </button>
          ))}
        </div>
      </PageHeader>

      {tab === "employees" && <TeamPanel />}
      {tab === "customers" && <ContactsPanel types={CUSTOMER_TYPES} addLabel={t("people.add", { name: L.customer_singular })} />}
      {tab === "vendors" && <ContactsPanel types={VENDOR_TYPES} addLabel={t("people.add", { name: L.vendor_singular })} />}
    </div>
  );
}
