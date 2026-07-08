import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { PageHeader } from "../components/common";
import { UsersThree, AddressBook, Truck } from "@phosphor-icons/react";
import { TeamPanel } from "./Team";
import { ContactsPanel } from "./Contacts";

export default function People() {
  const { user } = useAuth();
  const canTeam = hasPerm(user, "team_manage");
  const [tab, setTab] = useState(canTeam ? "employees" : "customers");

  const TABS = [
    ...(canTeam ? [{ key: "employees", label: "Employees", icon: UsersThree }] : []),
    { key: "customers", label: "Customers", icon: AddressBook },
    { key: "vendors", label: "Vendors", icon: Truck },
  ];

  return (
    <div>
      <PageHeader eyebrow="Your people — team, customers & vendors" title="People">
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
      {tab === "customers" && <ContactsPanel types={["customer", "dealer"]} addLabel="Add Customer" />}
      {tab === "vendors" && <ContactsPanel types={["vendor"]} addLabel="Add Vendor" />}
    </div>
  );
}
