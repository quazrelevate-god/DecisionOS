/**
 * /design-system — the living token reference.
 *
 * Every value on this page is READ FROM src/lib/tokens.js at runtime. Nothing is
 * transcribed, so the page cannot drift from the system: if a token changes, this
 * page changes with it, and if it looks wrong here it is wrong everywhere.
 *
 * Contrast ratios are computed live with the same function the test suite uses, so
 * what you read here is what CI enforces.
 *
 * Phase 1 ships the foundations below. Component sections (primitives, composites,
 * app-specific) are appended as each phase lands.
 */
import { useState } from "react";
import {
  palette,
  semantic,
  terminal,
  typography,
  radius,
  spacing,
  elevation,
  controlHeight,
  contrastRatio,
  hslTripletToHex,
} from "@/lib/tokens";
import { useTheme } from "@/hooks/useTheme";
import { PrimitivesGallery } from "@/components/ds/__examples__/PrimitivesGallery";
import { CompositesGallery } from "@/components/ds/__examples__/CompositesGallery";
import { AppControlsGallery } from "@/components/ds/__examples__/AppControlsGallery";
import { TerminalBlock } from "@/components/ds";
import { Sun, Moon, CheckCircle, WarningCircle } from "@phosphor-icons/react";

const WHITE = "0 0% 100%";
const ratio = (a, b) => Math.round(contrastRatio(a, b) * 100) / 100;

/* ------------------------------------------------------------------ layout */

function Section({ id, title, intro, children }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-hairline pt-10 mt-10 first:border-0 first:mt-0 first:pt-0">
      <h2 className="text-h2 text-text">{title}</h2>
      {intro && <p className="text-body text-text-secondary mt-2 max-w-3xl">{intro}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Label({ children }) {
  return <p className="text-label uppercase text-text-tertiary">{children}</p>;
}

/** AA verdict chip. Uses the same thresholds as the token test suite. */
function Ratio({ value, large = false, nonText = false }) {
  const threshold = nonText ? 3 : large ? 3 : 4.5;
  const pass = value >= threshold;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        pass ? "bg-status-completed-bg text-status-completed-fg" : "bg-status-overdue-bg text-status-overdue-fg"
      }`}
      title={`${value}:1 against a ${threshold}:1 threshold`}
    >
      {pass ? <CheckCircle size={11} weight="bold" /> : <WarningCircle size={11} weight="bold" />}
      {value.toFixed(2)}
    </span>
  );
}

/* ------------------------------------------------------------- colour roles */

const ROLE_RULES = {
  brand: { rule: "Identity · active navigation · one primary action", never: "danger, urgency, decoration" },
  danger: { rule: "Errors · overdue work · destructive actions", never: "branding, navigation, emphasis" },
  caution: { rule: "Pending · waiting for input · review holds", never: "general attention or hype" },
  success: { rule: "Done · verified · reconciled · closed", never: "generic positive decoration" },
  neutral: { rule: "The everyday system — surfaces, text, hairlines", never: "carrying state or urgency" },
};

function RoleScale({ role }) {
  const steps = palette[role];
  const meta = ROLE_RULES[role];
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <h3 className="text-h3 text-text capitalize">{role}</h3>
        <p className="text-small text-text-secondary">{meta.rule}</p>
        <p className="text-small text-danger-700 dark:text-danger-300">Never: {meta.never}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2">
        {Object.entries(steps).map(([step, value]) => {
          const onWhite = ratio(value, WHITE);
          return (
            <div key={step} className="min-w-0">
              <div
                className="h-14 rounded-md border border-hairline"
                style={{ backgroundColor: `hsl(${value})` }}
              />
              <p className="text-label uppercase text-text-tertiary mt-1.5">{step}</p>
              <p className="text-[11px] text-text-secondary tabular-nums truncate">{hslTripletToHex(value)}</p>
              <p className="text-[11px] text-text-tertiary tabular-nums" title="contrast against white">
                {onWhite.toFixed(1)}:1
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ semantic pairs */

function SemanticTable() {
  const keys = Object.keys(semantic.light);
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full text-small">
        <thead className="bg-surface-sunken">
          <tr className="text-left">
            <th className="p-3 text-label uppercase text-text-tertiary font-semibold">Token</th>
            <th className="p-3 text-label uppercase text-text-tertiary font-semibold" colSpan={2}>Light (canonical)</th>
            <th className="p-3 text-label uppercase text-text-tertiary font-semibold" colSpan={2}>Dark</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t border-hairline">
              <td className="p-3 font-medium text-text whitespace-nowrap">--{k}</td>
              <td className="p-3 w-8">
                <span className="block w-6 h-6 rounded-sm border border-hairline" style={{ backgroundColor: `hsl(${semantic.light[k]})` }} />
              </td>
              <td className="p-3 text-text-secondary tabular-nums whitespace-nowrap">{hslTripletToHex(semantic.light[k])}</td>
              <td className="p-3 w-8">
                <span className="block w-6 h-6 rounded-sm border border-hairline" style={{ backgroundColor: `hsl(${semantic.dark[k]})` }} />
              </td>
              <td className="p-3 text-text-secondary tabular-nums whitespace-nowrap">{hslTripletToHex(semantic.dark[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------- status tints */

const STATUSES = [
  ["Pending", "status-pending"],
  ["Directive", "status-directive"],
  ["Overdue", "status-overdue"],
  ["Completed", "status-completed"],
];
const PRIORITIES = [
  ["Priority low", "priority-low"],
  ["Priority med", "priority-med"],
  ["Priority high", "priority-high"],
];

function TintPreview({ label, base, theme }) {
  const t = semantic[theme];
  const bg = t[`${base}-bg`];
  const fg = t[`${base}-fg`];
  return (
    <div className="flex items-center gap-3">
      <span
        className="inline-block rounded-pill px-2.5 py-1 text-badge uppercase font-semibold whitespace-nowrap"
        style={{ backgroundColor: `hsl(${bg})`, color: `hsl(${fg})` }}
      >
        {label}
      </span>
      <Ratio value={ratio(fg, bg)} />
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export default function DesignSystem() {
  const { isDark, toggle } = useTheme();
  const [tintTheme, setTintTheme] = useState("light");

  return (
    <div className="min-h-screen bg-background text-text">
      <header className="sticky top-0 z-10 border-b border-hairline bg-background/85 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-label uppercase text-text-tertiary">DecisionOS / System reference</p>
            <p className="text-body-strong text-text truncate">Tokens, primitives, composites, app controls</p>
          </div>
          <button
            onClick={toggle}
            data-testid="ds-theme-toggle"
            className="h-control-sm px-3 inline-flex items-center gap-2 rounded-md border border-hairline text-small text-text-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring transition-colors"
          >
            {isDark ? <Sun size={15} weight="bold" /> : <Moon size={15} weight="bold" />}
            {isDark ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <p className="text-body text-text-secondary max-w-3xl">
          Every value here is read from <code className="text-text">src/lib/tokens.js</code> at runtime and every
          contrast ratio is computed with the function the test suite uses. Nothing on this page is transcribed, so it
          cannot drift from the system.
        </p>

        <Section
          id="colour"
          title="Colour is operational language"
          intro="Colour is assigned by role, never by hue. Light mode is canonical: semantic surfaces use pale 50–100 backgrounds with 700–800 text. The number under each swatch is its contrast against white."
        >
          {["brand", "danger", "caution", "success", "neutral"].map((role) => (
            <RoleScale key={role} role={role} />
          ))}
        </Section>

        <Section id="semantic" title="Semantic tokens, paired" intro="Every semantic key is defined in both themes; the test suite fails if one side is missing.">
          <details className="rounded-lg border border-hairline bg-surface">
            <summary className="cursor-pointer select-none px-4 py-3 text-body-strong text-text">
              Show all {Object.keys(semantic.light).length} paired tokens
            </summary>
            <div className="p-4 pt-0">
              <SemanticTable />
            </div>
          </details>
        </Section>

        <Section
          id="status"
          title="Status and priority"
          intro="Light-tint background with dark coloured text. Uppercase, tracked, sans — never monospace. Every pair is checked against the 4.5:1 AA threshold in both themes."
        >
          <div className="flex items-center gap-2 mb-5">
            {["light", "dark"].map((th) => (
              <button
                key={th}
                onClick={() => setTintTheme(th)}
                className={`h-control-sm px-3 rounded-md text-small font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring ${
                  tintTheme === th
                    ? "bg-primary-tint text-primary-text"
                    : "text-text-secondary hover:bg-surface-hover"
                }`}
              >
                {th} values
              </button>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STATUSES.map(([label, base]) => (
              <TintPreview key={base} label={label} base={base} theme={tintTheme} />
            ))}
          </div>
          <div className="grid sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-hairline">
            {PRIORITIES.map(([label, base]) => (
              <TintPreview key={base} label={label} base={base} theme={tintTheme} />
            ))}
          </div>
          <p className="text-small text-text-secondary mt-4 max-w-3xl">
            Priority withholds red deliberately: high priority is not the same claim as overdue, so high reads as
            caution and med/low as neutral weight. Red stays danger and overdue only.
          </p>
        </Section>

        <Section
          id="urgency"
          title="Urgency is a left edge"
          intro="In grouped feeds urgency is carried by a coloured left edge and nothing else. It never becomes a full-row alarm."
        >
          <div className="rounded-lg border border-hairline overflow-hidden">
            {[
              ["Overdue", "urgency-overdue", "Supplier payment confirmation"],
              ["Today", "urgency-today", "Approve dispatch schedule"],
              ["This week", "urgency-week", "Reconcile packaging invoice"],
              ["Later", "urgency-later", "Review quarterly headcount"],
            ].map(([group, token, sample]) => (
              <div key={token} className="flex items-stretch border-b border-hairline last:border-0 bg-surface">
                <span className="w-1 shrink-0" style={{ backgroundColor: `hsl(${semantic.light[token]})` }} />
                <div className="flex-1 flex items-center justify-between gap-4 px-4 py-3 min-w-0">
                  <div className="min-w-0">
                    <p className="text-label uppercase text-text-tertiary">{group}</p>
                    <p className="text-body text-text truncate">{sample}</p>
                  </div>
                  {token === "urgency-later" ? (
                    // "Later" carries no urgency, so it is deliberately below the 3:1
                    // signalling threshold — grading it as a failure would be wrong.
                    <span className="text-[11px] text-text-tertiary whitespace-nowrap">no signal</span>
                  ) : (
                    <Ratio value={ratio(semantic.light[token], semantic.light.surface)} nonText />
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="type"
          title="One sans-serif"
          intro="Inter everywhere. Uppercase is reserved for labels, badges and metadata; body copy is sentence case. Numbers are tabular so figures align in columns."
        >
          <div className="space-y-5">
            {Object.entries(typography.scale).map(([name, [size, meta]]) => (
              <div key={name} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline pb-4">
                <div className="w-28 shrink-0">
                  <Label>{name}</Label>
                  <p className="text-[11px] text-text-tertiary tabular-nums">
                    {size} / {meta.lineHeight} / {meta.fontWeight}
                  </p>
                </div>
                <p
                  // The `code` step is rendered in its own face on purpose —
                  // this row is the specimen FOR the monospace step, so the
                  // class is the subject, not a stray usage. sweep.js skips
                  // this file for the same reason.
                  className={`min-w-0 ${name === "code" ? "font-mono" : ""} ${
                    name === "label" || name === "badge" ? "uppercase" : ""
                  }`}
                  style={{
                    fontSize: size,
                    lineHeight: meta.lineHeight,
                    letterSpacing: meta.letterSpacing,
                    fontWeight: meta.fontWeight,
                  }}
                >
                  {name === "code"
                    ? "cash_position   ₹18,42,300"
                    : "Move the ₹4,80,000 payment to Friday"}
                </p>
              </div>
            ))}
          </div>
          <p className="text-small text-text-secondary mt-4">
            The <code>code</code> step is the sole monospace exception and exists only for the Company Brain terminal.
          </p>
        </Section>

        <Section
          id="structure"
          title="Structure"
          intro="Depth comes from the hairline, not from shadow. Cards default to 12px."
        >
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <Label>Radius</Label>
              <div className="mt-3 space-y-2">
                {Object.entries(radius).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="w-10 h-10 bg-primary-tint border border-hairline" style={{ borderRadius: v }} />
                    <span className="text-small text-text-secondary tabular-nums">{k} · {v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>Control height</Label>
              <div className="mt-3 space-y-2">
                {Object.entries(controlHeight).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="w-20 bg-surface-sunken border border-hairline rounded-md" style={{ height: v }} />
                    <span className="text-small text-text-secondary tabular-nums">{k} · {v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>Elevation</Label>
              <div className="mt-3 space-y-3">
                {Object.entries(elevation).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="w-10 h-10 bg-surface border border-hairline rounded-md" style={{ boxShadow: v }} />
                    <span className="text-small text-text-secondary">{k}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>Spacing</Label>
              <div className="mt-3 space-y-1.5">
                {Object.entries(spacing)
                  .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
                  .map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="h-2 bg-primary rounded-sm" style={{ width: v }} />
                    <span className="text-small text-text-secondary tabular-nums">{k} · {v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="terminal"
          title="Company Brain terminal"
          intro="Dark in both themes, monospace, cited rows. This is the only place monospace appears anywhere in the system."
        >
          {/* The real component, not a copy of it: this preview used to be
              hand-rolled markup with its own font-mono, which sat outside
              components/ds and therefore outside the lint allowlist — a blanket
              mono rule nearly stripped it during the migration sweep. Rendering
              TerminalBlock means the only monospace in the codebase lives in the
              one file the lint rule protects. */}
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
          <div className="flex flex-wrap gap-4 mt-4">
            <span className="text-small text-text-secondary">
              body on terminal <Ratio value={ratio(terminal.fg, terminal.bg)} />
            </span>
            <span className="text-small text-text-secondary">
              dim on terminal <Ratio value={ratio(terminal["fg-dim"], terminal.bg)} />
            </span>
            <span className="text-small text-text-secondary">
              label on terminal <Ratio value={ratio(terminal.label, terminal.bg)} />
            </span>
          </div>
        </Section>

        <Section
          id="primitives"
          title="Primitives"
          intro="Phase 2. Every interactive component ships all five states — default, hover, active, focus, disabled — plus loading where it applies. Hover and press these rather than reading them."
        >
          <PrimitivesGallery />
        </Section>

        <Section
          id="composites"
          title="Composites"
          intro="Phase 3. Cards, the approval card, assignee chips, the two kinds of progress, grouped feed rows and the empty state. Press the approval card's actions to see the in-flight state, and click a progress segment."
        >
          <CompositesGallery />
        </Section>

        <Section
          id="app-controls"
          title="App controls"
          intro="Phase 4. Sidebar nav, the header utility cluster, segmented control and filter pills, voice capture and the Company Brain terminal. Built standalone and proved here — Layout.js is deliberately not rewired to consume them on this branch."
        >
          <AppControlsGallery />
        </Section>

        <Section id="next" title="Next">
          <p className="text-body text-text-secondary max-w-3xl">
            Phase 2 adds primitives (button, input set, status badge) with all five states, Phase 3 composites
            including the approval card, Phase 4 the app-specific controls. Each appends its section here.
          </p>
        </Section>
      </main>
    </div>
  );
}
