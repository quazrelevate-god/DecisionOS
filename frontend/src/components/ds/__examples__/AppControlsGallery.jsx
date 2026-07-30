import { useState } from "react";
import { Tray, Sun, Briefcase, AddressBook, Brain, Wallet, GearSix } from "@phosphor-icons/react";
import { SidebarNav } from "../SidebarNav";
import { SegmentedControl, FilterPills } from "../SegmentedControl";
import { HeaderUtility, NotificationBell, ThemeToggle, LanguageSwitch } from "../HeaderUtility";
import { VoiceCapture, LanguageToggle } from "../VoiceCapture";
import { TerminalBlock } from "../TerminalBlock";
import { MobileDrawer } from "../MobileDrawer";
import { PageHeader } from "../PageHeader";
import { Button } from "../Button";
import { StatusBadge } from "../StatusBadge";

/**
 * Phase 4 gallery + usage examples for the app-specific controls.
 *
 * These are built standalone and proved here; Layout.js is deliberately NOT
 * rewired to consume them on this branch — that is app churn and belongs to the
 * migration phase.
 */

function Group({ title, intro, children }) {
  return (
    <div className="mb-10">
      <h3 className="text-h3 text-text">{title}</h3>
      {intro && <p className="text-body text-text-secondary mt-1 mb-4 max-w-3xl">{intro}</p>}
      {children}
    </div>
  );
}

function Case({ label, note, children }) {
  return (
    <div className="mb-5">
      <p className="text-label uppercase text-text-tertiary mb-1">{label}</p>
      {note && <p className="text-small text-text-tertiary mb-2 max-w-3xl">{note}</p>}
      {children}
    </div>
  );
}

const NAV_ITEMS = [
  { key: "inbox", label: "Decision Desk", icon: <Tray />, count: 3 },
  { key: "brief", label: "CEO Brief", icon: <Sun /> },
  { key: "mywork", label: "My Work", icon: <Briefcase />, overdueCount: 2 },
  { key: "people", label: "People", icon: <AddressBook /> },
  { key: "brain", label: "Company Brain", icon: <Brain /> },
  { key: "finance", label: "Finance", icon: <Wallet />, disabled: true, disabledReason: "Ask your owner for Finance access" },
  { key: "settings", label: "Settings", icon: <GearSix /> },
];

export function AppControlsGallery() {
  const [active, setActive] = useState("inbox");
  const [view, setView] = useState("mine");
  const [types, setTypes] = useState(["supplier"]);
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  const [lang, setLang] = useState("en");
  const [captureLang, setCaptureLang] = useState("auto");
  const [voice, setVoice] = useState("idle");
  const [unread, setUnread] = useState(3);
  const [drawer, setDrawer] = useState(false);

  const cycleVoice = () => {
    if (voice === "idle") return setVoice("listening");
    if (voice === "listening") {
      setVoice("processing");
      setTimeout(() => setVoice("idle"), 1600);
      return;
    }
  };

  return (
    <>
      <Group
        title="Sidebar navigation"
        intro="Active is an indigo tint with indigo text — brand marks where you are, one of the three things brand is for. Never a solid slab: navigation is not an action and would compete with the page's primary. Counts are neutral; only a genuinely overdue count earns danger."
      >
        <div className="flex flex-wrap gap-6">
          <div className="h-96 w-64 overflow-hidden rounded-lg border border-hairline">
            <SidebarNav items={NAV_ITEMS} activeKey={active} onSelect={(i) => setActive(i.key)} />
          </div>
          <div className="max-w-md text-small text-text-tertiary">
            <p className="mb-2">Click to move the active state. Tab through to see the focus ring.</p>
            <p className="mb-2">
              <span className="text-text">Finance</span> is disabled and stays visible rather than being hidden — a
              permission you do not have is information, and a menu that changes shape between users is harder to learn.
              Hover it for the reason.
            </p>
            <p>
              <span className="text-text">My Work</span> carries an overdue count in danger; Decision Desk carries a
              neutral count. "There are three of these" and "two of these are late" are different claims.
            </p>
          </div>
        </div>
      </Group>

      <Group
        title="Header utility cluster"
        intro="Everything here is tertiary. The moment one of these becomes a solid fill it outranks the page's actual primary — which is exactly what the Send Daily Digest button was doing before Phase 2."
      >
        <Case label="The cluster">
          <div className="flex items-center justify-end rounded-lg border border-hairline bg-surface px-4 py-3">
            <HeaderUtility>
              <LanguageSwitch
                value={lang}
                onValueChange={setLang}
                options={[
                  { value: "en", label: "English" },
                  { value: "hi", label: "हिन्दी" },
                  { value: "ta", label: "தமிழ்" },
                ]}
              />
              <ThemeToggle
                isDark={dark}
                onToggle={() => {
                  document.documentElement.classList.toggle("dark");
                  setDark((v) => !v);
                }}
              />
              <NotificationBell count={unread} onOpen={() => {}} onResolveAll={() => setUnread(0)} />
            </HeaderUtility>
          </div>
        </Case>

        <Case
          label="Capped, resolvable count"
          note="A permanent 99+ is a UI that has given up — the number stops being actionable, so people stop reading it and the badge becomes decoration. Past the cap the count is capped for display AND a way back to zero appears. Try it."
        >
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-hairline bg-surface px-4 py-3">
            <NotificationBell count={0} onOpen={() => {}} />
            <NotificationBell count={3} onOpen={() => {}} />
            <NotificationBell count={unread} onOpen={() => {}} onResolveAll={() => setUnread(0)} />
            <NotificationBell count={247} onOpen={() => {}} onResolveAll={() => {}} />
            <button
              type="button"
              className="text-small text-primary-text hover:underline"
              onClick={() => setUnread((n) => (n > 20 ? 3 : n + 9))}
            >
              Bump the third one
            </button>
          </div>
        </Case>
      </Group>

      <Group
        title="Segmented control and filter pills"
        intro="Selected is indigo text on an indigo tint, never a solid fill: these switch a view, they do not perform the screen's action. Arrow keys move between segments — a segmented control that only answers to clicks is a row of buttons in a costume."
      >
        <Case label="Segmented control" note="One choice from a fixed set that reshapes the view below.">
          <SegmentedControl
            label="Task view"
            value={view}
            onValueChange={setView}
            options={[
              { value: "mine", label: "Mine", count: 4 },
              { value: "team", label: "Team", count: 12 },
              { value: "all", label: "All", count: 31 },
              { value: "archive", label: "Archive", disabled: true },
            ]}
          />
        </Case>

        <Case
          label="Filter pills"
          note="Additive filters. Counts are always shown, including zero — a zero says the filter exists and is empty, which is different from the filter being missing."
        >
          <FilterPills
            label="Type"
            multiple
            value={types}
            onValueChange={setTypes}
            options={[
              { value: "customer", label: "Customer", count: 8 },
              { value: "supplier", label: "Supplier", count: 3 },
              { value: "invoice", label: "Invoice", count: 12 },
              { value: "payment", label: "Payment", count: 0 },
              { value: "complaint", label: "Complaint", count: 1 },
            ]}
          />
        </Case>
      </Group>

      <Group
        title="Voice capture"
        intro="The one primary action of its module. It is NOT red while listening — red would say something is wrong when the system is doing exactly what was asked. Listening is expressed with motion, so the state is unmistakable without spending the danger colour on it."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-hairline bg-surface p-6">
            <VoiceCapture
              state={voice}
              onStart={cycleVoice}
              onStop={cycleVoice}
              hint={voice === "listening" ? "00:07" : "Speak in any language — AI writes it up in English"}
              languageControl={<LanguageToggle value={captureLang} onValueChange={setCaptureLang} />}
            />
            <p className="mt-4 text-center text-small text-text-tertiary">
              Click: idle → listening → processing → idle
            </p>
          </div>
          <div className="rounded-lg border border-hairline bg-surface p-6">
            <VoiceCapture state="processing" onStart={() => {}} onStop={() => {}} hint="Transcribing" />
            <p className="mt-4 text-center text-small text-text-tertiary">Processing</p>
          </div>
          <div className="rounded-lg border border-hairline bg-surface p-6">
            <VoiceCapture
              state="idle"
              disabled
              disabledReason="Microphone access denied — allow it in your browser settings"
              onStart={() => {}}
              onStop={() => {}}
            />
            <p className="mt-4 text-center text-small text-text-tertiary">Disabled</p>
          </div>
        </div>
      </Group>

      <Group
        title="Page header"
        intro="The action slot is deliberately singular. Screens accumulate buttons one reasonable addition at a time, and a header with four equal buttons is how a product loses its answer to 'what am I here to do?'. The primary sits first in the DOM so it is announced first, and is pushed rightmost with order-last."
      >
        <div className="rounded-lg border border-hairline bg-surface p-5">
          <PageHeader
            breadcrumbs={[{ label: "DecisionOS", onClick: () => {} }, { label: "Decision Desk" }]}
            title="Decision Desk"
            description="Everything waiting on your decision, and the three ways to capture a new one."
            meta={<StatusBadge status="pending">3 pending</StatusBadge>}
            primaryAction={<Button>Capture a decision</Button>}
            secondaryActions={<Button variant="tertiary">Export</Button>}
          />
        </div>
      </Group>

      <Group
        title="Mobile drawer"
        intro="The product is used on phones, so this is the primary navigation for most sessions rather than a fallback. Body scroll locks while open, Escape closes it, focus moves in on open and returns to the trigger on close, and Tab cannot walk into the page behind. The scrim is neutral — a tinted overlay makes the app underneath look like it errored."
      >
        <Button variant="secondary" onClick={() => setDrawer(true)}>
          Open the drawer
        </Button>
        <MobileDrawer open={drawer} onClose={() => setDrawer(false)} title="Navigation">
          <SidebarNav
            items={NAV_ITEMS}
            activeKey={active}
            onSelect={(i) => {
              setActive(i.key);
              setDrawer(false);
            }}
          />
        </MobileDrawer>
        <p className="mt-2 text-small text-text-tertiary">
          Opens at any viewport here so it can be reviewed on desktop; in the app it is hidden above the lg breakpoint.
          Try Escape and Tab.
        </p>
      </Group>

      <Group
        title="Company Brain terminal"
        intro="Dark in both themes, and the only place monospace appears anywhere in the system — the lint rule allowlists this file by name and nothing else. Confidence and citations are stated, not implied: a model answer with no visible provenance is indistinguishable from a guess."
      >
        <TerminalBlock
          rows={[
            { key: "cash_position", value: "₹18,42,300" },
            { key: "payroll_run", value: "₹12,10,000", note: "due Aug 01" },
            { key: "supplier_due", value: "₹4,80,000", note: "negotiable" },
            { key: "recommendation", value: "hold until Friday" },
          ]}
          confidence={0.92}
          sourceCount={3}
        />
        <div className="mt-4">
          <TerminalBlock loading rows={[]} />
        </div>
      </Group>
    </>
  );
}
