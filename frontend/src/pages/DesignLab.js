// MPWA-12a · /design-lab (§6) — development only.
//
// §6: "This replaces mockups. It uses real tokens, real components and real data
// shapes, so what is approved is what ships."
//
// Screens are rendered in iframes at exactly 390x844 with `?fixture=` set, which
// is the only honest way to show three data states side by side: they are real
// routes running the real components against the real query layer, not
// re-implementations. Blocks render inline, since they are pure presentation.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FIXTURE_NAMES, FIXTURE_LABEL } from "../fixtures/mobile";
import { Verdict, Pulse, Queue, Board, Grid, Strip, CompletionRing } from "../components/mobile/blocks";
import { EmptyState } from "../components/mobile";
import { inr } from "../lib/format";
import { Fire, Sun, Stamp, Star, Camera, CheckCircle, Wallet, CalendarBlank, Bell } from "@phosphor-icons/react";
// KR-4 — the Karma kit under test.
import {
  IconChip, ArrowButton, BigNumeral, PillNav, DarkBand,
  DotProgress, MiniBars, CircleDots,
} from "../components/karma";
// KM-19 — the onboarding build animation. It lives three phases deep in
// /signup, behind a real registration, so this gallery is the only place it
// can be looked at without creating a tenant to see it.
import { DexForge } from "./onboarding/DexForge";
// KM-23 — the voice surface in all four of its states. It only ever appears
// inside the dock while the mic is live, so this is the one place the idle,
// thinking and speaking states can be looked at without recording something.
import { DexWave } from "../components/mobile/DexWave";
/* ASK-44 — the voice ripple under review. It is NOT wired into the app: the
   founder asked for it here first ("once we finalize it we will add it to our
   web application"), so this page is its only call site and the component sits
   in pages/designlab/ rather than in components/ where the app would find it. */
import { VoiceRipple, RIPPLE_DEFAULTS } from "./designlab/VoiceRipple";

const SCREENS = [
  { path: "/inbox", label: "Desk · now" },
  { path: "/inbox?scope=morning", label: "Desk · morning" },
  { path: "/finance", label: "Money" },
  { path: "/my-work", label: "My Work" },
  { path: "/workflows", label: "Workflows · board" },
  { path: "/crm", label: "CRM" },
];

const VW = 390;
const VH = 844;

const withFixtureParam = (path, fixture) => {
  const [p, q = ""] = path.split("?");
  const params = new URLSearchParams(q);
  params.set("fixture", fixture);
  return `${p}?${params.toString()}`;
};

/**
 * One phone-sized frame plus the measurements the §8 acceptance table asks for:
 * first-viewport fill, distinct block types, progress-element count, and the
 * largest vertical white gap. Measured in the live DOM of the iframe, so the
 * numbers are the same ones the audit harness reads.
 */
function Frame({ path, fixture }) {
  const ref = useRef(null);
  const [m, setM] = useState(null);

  const measure = () => {
    const win = ref.current?.contentWindow;
    const doc = win?.document;
    if (!doc?.body) return;
    try {
      const main = doc.querySelector("main") || doc.body;
      const blocks = [...doc.querySelectorAll("[data-block]")];
      const types = [...new Set(blocks.map((b) => b.getAttribute("data-block")))];
      const progress = doc.querySelectorAll("[data-progress]").length;

      // The lab has to agree with the harness or it teaches the wrong lesson, so
      // it measures the same two things the same two ways (MPWA-12i):
      //   fill — content-box coverage, over the band that starts at <main>
      //   gap  — INK coverage, so a tall empty container cannot pass by being tall
      const ROW = 8;
      const bandTop = Math.max(0, Math.round(main.getBoundingClientRect().top));
      const rows = Math.max(1, Math.floor((VH - bandTop) / ROW));
      const mark = (arr, r) => {
        const from = Math.max(0, Math.floor((r.top - bandTop) / ROW));
        const to = Math.min(rows - 1, Math.floor((r.bottom - bandTop) / ROW));
        for (let i = from; i <= to; i++) arr[i] = true;
      };
      const visible = (el) => {
        const cs = win.getComputedStyle(el);
        return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) !== 0;
      };

      const boxCovered = new Array(rows).fill(false);
      for (const el of main.querySelectorAll(
        '[data-block], [data-empty-screen], [data-empty-state], h1, section, form, ul, ol, table, input, textarea, button'
      )) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || !visible(el)) continue;
        mark(boxCovered, r);
      }
      const fill = Math.round((boxCovered.filter(Boolean).length / rows) * 100);

      const inkCovered = new Array(rows).fill(false);
      const leaves = [...main.querySelectorAll("*")].filter(
        (el) => el.children.length === 0 || /^(P|H1|H2|H3|SPAN|BUTTON|A|LI|IMG|SVG|INPUT|TEXTAREA)$/.test(el.tagName)
      );
      for (const el of leaves) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || !visible(el)) continue;
        mark(inkCovered, r);
      }
      const ink = Math.round((inkCovered.filter(Boolean).length / rows) * 100);

      // Largest run of uncovered ink rows = largest vertical white gap.
      let gap = 0;
      let run = 0;
      for (const c of inkCovered) {
        run = c ? 0 : run + 1;
        gap = Math.max(gap, run);
      }

      setM({
        fill,
        ink,
        gap: gap * ROW,
        types,
        progress,
        height: doc.scrollingElement?.scrollHeight ?? 0,
      });
    } catch {
      setM(null); // cross-origin should never happen here, but never crash the lab
    }
  };

  useEffect(() => {
    const t = setInterval(measure, 1200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ok = (pass) => (pass ? "text-success-700" : "text-danger-700");

  return (
    <figure className="m-0 shrink-0">
      <figcaption className="mb-1.5 flex items-baseline gap-2">
        <span className="text-sm font-semibold">{FIXTURE_LABEL[fixture]}</span>
        {m && (
          <span className="text-[length:var(--text-label)] leading-4 text-muted-foreground">
            <span className={ok(m.fill >= 85)} title={`${m.ink}% ink`}>{m.fill}% fill</span>
            {" · "}
            <span className={ok(m.types.length >= 3)}>{m.types.length} blocks</span>
            {" · "}
            <span className={ok(m.progress === 1)}>{m.progress} progress</span>
            {" · "}
            <span className={ok(m.gap <= 120)}>{m.gap}px gap</span>
          </span>
        )}
      </figcaption>
      <iframe
        ref={ref}
        title={`${path} ${fixture}`}
        src={withFixtureParam(path, fixture)}
        width={VW}
        height={VH}
        onLoad={measure}
        className="nm-raised"
        style={{ width: VW, height: VH }}
      />
      {m && (
        <p className="mt-1 text-[length:var(--text-label)] leading-4 text-muted-foreground">
          {m.height}px tall · {m.types.join(", ") || "no data-block yet"}
        </p>
      )}
    </figure>
  );
}

/**
 * The six blocks in isolation, at phone width, so the shape vocabulary can be
 * judged on its own before it is assembled into screens (§3).
 */
function BlockGallery() {
  const rows = [
    { id: "r1", title: "Confirm cotton supplier rates for Q3", status: "overdue", due: "2020-01-01", context: "With Amit Verma" },
    { id: "r2", title: "Hire a dispatch coordinator", status: "pending", statusLabel: "Waiting 6 days", context: "From Amit Verma", amount: 28000 },
    { id: "r3", title: "Lock supplier rates before the festive season", status: "pending", context: "From Priya Nair", amount: 12000 },
  ];
  return (
    <div className="w-[390px] shrink-0 rounded-xl border border-border bg-background p-4">
      <p className="mb-3 text-sm font-semibold text-muted-foreground">All six blocks · 390px</p>

      <Verdict
        tone="danger"
        eyebrow="Good morning, Rajesh"
        headline="1 decision is on fire."
        detail={
          <>
            <p className="font-heading text-[0.9375rem] font-semibold leading-snug">Confirm cotton supplier rates for Q3</p>
            <p className="mt-1 text-sm opacity-80">3 days overdue · Amit Verma</p>
          </>
        }
        action={{ label: "Review", onClick: () => {} }}
      />

      <Strip
        label="Scope"
        items={[
          { key: "now", label: "Now", active: true, onSelect: () => {} },
          { key: "morning", label: "Morning", onSelect: () => {} },
          { key: "week", label: "Week", onSelect: () => {} },
          { key: "month", label: "Month", onSelect: () => {} },
        ]}
        wrap
      />

      <Strip
        label="Cleared today"
        progress="cleared-today"
        items={[{ key: "cleared", label: "Cleared today — 4", count: null, tone: "success", trailing: <span aria-hidden="true">✓✓✓✓</span> }]}
        wrap
      />

      <Pulse
        stats={[
          { label: "Received", value: inr(2015000), series: [2, 4, 3, 6, 9, 15, 20], tone: "success", delta: 12 },
          { label: "Outstanding", value: inr(1712000), series: [22, 21, 20, 19, 18, 17, 17], tone: "danger", delta: -4, invertDelta: true },
        ]}
      />

      <Queue title="Waiting on you" rows={rows} total={6} onSeeAll={() => {}} />

      <Grid
        title="Where the money is"
        items={[
          { id: "g1", label: "Raw material", value: inr(1264000) },
          { id: "g2", label: "Salaries", value: inr(1724000) },
        ]}
        renderTile={(t) => (
          <>
            <span className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">{t.label}</span>
            <span className="mt-1 block font-heading text-lg font-bold tabular-nums">{t.value}</span>
          </>
        )}
      />

      <Board
        columns={[
          { key: "quote", label: "Quotation", count: 3, done: 1, total: 3, items: [{ id: "b1", title: "Order #4801" }, { id: "b2", title: "Order #4802" }] },
          { key: "prod", label: "Production", count: 5, done: 2, total: 5, items: [{ id: "b3", title: "Order #4803" }] },
          { key: "disp", label: "Dispatch", count: 2, done: 2, total: 2, items: [] },
        ]}
        renderItem={(it) => (
          <div className="nm-raised p-3">
            <p className="text-sm font-semibold">{it.title}</p>
          </div>
        )}
        onMove={() => {}}
      />

      <EmptyState
        icon={Camera}
        title="Nothing recorded yet."
        hint="Snap a bill and Dex will file it."
        actionLabel="Photograph a bill"
        onAction={() => {}}
      />
    </div>
  );
}

/* KR-4 — the Karma kit, rendered once in every ambience it must survive:
   the light zone, the dark band, and glass. This section is the visual QA
   surface for the whole foundation — if a primitive reads wrong anywhere,
   it reads wrong HERE first, before any page adopts it. */
function KarmaGallery() {
  return (
    <section className="mb-10" data-testid="karma-gallery">
      <h2 className="text-h2 mb-3">Karma kit</h2>

      {/* KM-23 · DexWave — all four states side by side, on ink, which is the
          only surface it is ever drawn on. `level` is faked with a slow sine
          for the listening lane so it moves without a microphone. */}
      <div className="mb-6 rounded-cardlg bg-kr-ink p-5">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
          DexWave · idle · listening · thinking · speaking
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {["idle", "listening", "thinking", "speaking"].map((st) => (
            <div key={st}>
              <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-white/35">{st}</p>
              <div className="h-11 w-full overflow-hidden rounded-pill bg-white/[.04]">
                <DexWave state={st} level={st === "listening" ? undefined : 0} levels={st === "listening" ? [0.7] : undefined} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* KM-19 · DexForge — onboarding's build animation, on the same ground
          the app uses, so a change to .kr-pop or .kr-pressed shows up here. */}
      <div className="app-canvas mb-6 rounded-cardlg p-6" style={{ background: "hsl(var(--nm-bg))" }}>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          DexForge · /signup build
        </p>
        <DexForge />
      </div>

      {/* light zone */}
      <div className="app-canvas rounded-cardlg p-6" style={{ background: "hsl(var(--nm-bg))" }}>
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <PillNav
            testid="kg-pills"
            items={[
              { to: "/design-lab", label: "Karma", end: true },
              { to: "/design-lab?x=1", label: "Credits" },
              { to: "/design-lab?x=2", label: "Money", badge: 3 },
            ]}
          />
          <IconChip icon={Wallet} />
          <IconChip icon={CalendarBlank} alert />
          <IconChip icon={Bell} alert={7} />
          <ArrowButton label="Open example" />
          <ArrowButton label="Open small" size="sm" />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="nm-raised kr-lift p-5" data-testid="kg-tile">
            <div className="flex items-start justify-between">
              <IconChip icon={Wallet} alert />
              <ArrowButton label="Open money" to="/finance" />
            </div>
            <p className="mt-5 text-sm text-muted-foreground">Total Dept</p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <BigNumeral text={inr(64100)} size="lg" />
              <MiniBars values={[4, 7, 3, 8, 6, 9]} accentIndex={5} />
            </div>
          </div>
          <div className="nm-raised kr-lift p-5">
            <div className="flex items-start justify-between">
              <IconChip icon={CheckCircle} />
              <ArrowButton label="Open payment history" />
            </div>
            <p className="mt-5 text-sm italic text-muted-foreground">Payment History</p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <BigNumeral text="100%" size="lg" countUp />
              <DotProgress value={100} total={100} />
            </div>
          </div>
          <div className="kr-glass kr-glass--blue kr-lift p-5" data-testid="kg-glass">
            <div className="flex items-start justify-between">
              <IconChip icon={Star} />
              <ArrowButton label="Open credit use" style={{ "--kr-action-bg": "0 0% 100%", "--kr-action-fg": "var(--kr-ink)" }} />
            </div>
            <p className="mt-5 text-sm italic opacity-80">Credit Card Use</p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <BigNumeral text="9%" size="lg" />
              <CircleDots count={2} />
            </div>
          </div>
        </div>
      </div>

      {/* the band */}
      <DarkBand testid="kg-band" className="mt-6 py-8 rounded-cardlg" reveal={false}>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-h2">History</span>
          <span className="inline-flex items-center rounded-pill border border-kr-outline px-3.5 h-9 text-sm">3 months</span>
          <span className="inline-flex items-center rounded-pill bg-white text-kr-ink px-3.5 h-9 text-sm font-medium">6 months</span>
          <ArrowButton label="See all offers" />
          <IconChip icon={Fire} alert={2} />
          <span className="kr-glass kr-glass--olive px-4 py-3 text-sm" data-testid="kg-band-glass">
            Bank of America · Rate <strong>8%</strong>
          </span>
          {/* KR-8.12 — `accent` dropped here. It used to mean "orange"; it
              now means ink at 80%, which on the band would be ink on ink.
              Every real call site is a light tile, so the prop is a
              light-surface tool and this demo should not imply otherwise. */}
          <BigNumeral text={inr(685000)} size="md" testid="kg-band-numeral" />
        </div>
      </DarkBand>
    </section>
  );
}

/* ASK-44 / ASK-45 · the ripple, with the knobs it is being judged on.
   Seven, because seven is what the founder asked to be able to turn and each
   one changes a different thing about the same wave: how hard a voice pushes
   it, how heavy its ridge is, how far that ridge blurs, how far it is allowed
   to stop being a circle, how much it springs back as it travels, how fast it
   travels and how many are in flight at once. The values are printed under the
   panel in the shape the component takes, so whatever is settled on can be
   pasted straight back rather than described. The simulate switch exists so the
   motion can be watched without granting the microphone; it is labelled,
   because a fake level presented as a real one would be the one dishonest
   thing on this page. */
const RIPPLE_KNOBS = [
  { key: "gain", label: "Gain", min: 0.4, max: 2.2, step: 0.05, hint: "how hard a voice pushes" },
  { key: "thickness", label: "Thickness", min: 0.3, max: 3, step: 0.05, hint: "the weight of the ridge" },
  { key: "softness", label: "Softness", min: 0, max: 2.5, step: 0.05, hint: "how far it blurs" },
  { key: "water", label: "Water", min: 0, max: 1, step: 0.02, hint: "0 is a circle, 1 has a mind" },
  { key: "elastic", label: "Elastic", min: 0, max: 1, step: 0.02, hint: "overshoot and settle" },
  { key: "speed", label: "Speed", min: 0.4, max: 2.2, step: 0.05, hint: "travel time" },
  { key: "density", label: "Density", min: 0.3, max: 2.5, step: 0.05, hint: "waves in flight" },
];

function VoiceRippleLab() {
  const [cfg, setCfg] = useState(RIPPLE_DEFAULTS);
  const [simulate, setSimulate] = useState(false);
  const [copied, setCopied] = useState(false);
  const set = (key) => (e) => setCfg((c) => ({ ...c, [key]: Number(e.target.value) }));
  const json = JSON.stringify(cfg, null, 0).replace(/","/g, '", "');

  return (
    <section className="mb-7 rounded-cardlg border border-border bg-background p-5" data-testid="lab-voice-ripple">
      <h2 className="font-heading text-lg font-bold tracking-tight">Voice ripple · ASK-44/45</h2>
      <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
        The mic at the centre, and the surface around it answering what it hears. Every wave is a
        ridge — white up-and-left, blue-grey down-and-right, both blurred — so it is lit from the
        same corner as <code>.kr-pressed</code> and reads as the surface moving rather than as ink
        on it. Each one carries its OWN random outline (control points on a Catmull-Rom curve, a
        fresh set per wave, morphing as it travels), springs past its mark and settles, and relaxes
        back toward round as it goes, the way surface tension pulls at real water. The level is a
        real AnalyserNode on the live stream, through the same RMS curve the dock&rsquo;s wave uses.
        Nothing travels under prefers-reduced-motion. Not in the app — this page is its only call
        site.
      </p>
      <div className="mt-4 flex flex-wrap items-start gap-8">
        <VoiceRipple size={340} config={cfg} simulate={simulate} />
        <div className="min-w-[22rem] flex-1">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {RIPPLE_KNOBS.map((k) => (
              <label key={k.key} className="flex flex-col gap-0.5 text-sm">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-foreground">{k.label}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {cfg[k.key].toFixed(2)}
                  </span>
                </span>
                {/* accentColor keeps the native control in the app's palette — a
                    Chrome blue slider beside a neumorphic wave is the one thing
                    on this card that would not be ours. */}
                <input
                  type="range" min={k.min} max={k.max} step={k.step} value={cfg[k.key]}
                  onChange={set(k.key)}
                  data-testid={`lab-ripple-${k.key}`}
                  aria-label={`${k.label} — ${k.hint}`}
                  style={{ accentColor: "hsl(var(--kr-ink))" }}
                />
                <span className="text-[length:var(--text-label)] leading-4 text-muted-foreground">{k.hint}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSimulate((v) => !v)}
              data-testid="lab-ripple-simulate"
              className={`rounded-pill border px-3.5 text-sm font-semibold ${
                simulate ? "border-transparent bg-foreground text-background" : "border-border bg-card"
              }`}
              style={{ minHeight: "var(--control-h-sm)" }}
            >
              {simulate ? "Simulated level: on" : "Simulate a level"}
            </button>
            <button
              type="button"
              onClick={() => { setCfg(RIPPLE_DEFAULTS); setCopied(false); }}
              data-testid="lab-ripple-reset"
              className="rounded-pill border border-border bg-card px-3.5 text-sm font-semibold"
              style={{ minHeight: "var(--control-h-sm)" }}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(json).then(() => setCopied(true)).catch(() => setCopied(false));
              }}
              data-testid="lab-ripple-copy"
              className="rounded-pill border border-border bg-card px-3.5 text-sm font-semibold"
              style={{ minHeight: "var(--control-h-sm)" }}
            >
              {copied ? "Copied" : "Copy settings"}
            </button>
          </div>

          <p className="mt-3 break-all font-mono text-xs text-muted-foreground" data-testid="lab-ripple-json">
            {json}
          </p>
        </div>
      </div>
    </section>
  );
}

export default function DesignLab() {
  const [screen, setScreen] = useState(SCREENS[0].path);
  const [states, setStates] = useState(FIXTURE_NAMES);
  const [showBlocks, setShowBlocks] = useState(true);

  const shown = useMemo(() => FIXTURE_NAMES.filter((f) => states.includes(f)), [states]);

  return (
    <div className="min-h-[calc(100vh/var(--ui-scale,1))] bg-background p-6" data-testid="design-lab">
      <header className="mb-5">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Design lab</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Real routes, real components, real query layer — rendered at 390×844 against each
          fixture state (§4). Thresholds from §8: ≥85% fill, ≥3 block types, exactly 1 progress
          element, ≤120px largest gap. Fill is content-box coverage from the top of{" "}
          <code>main</code>; the gap is measured on ink, so a tall empty box cannot pass by being
          tall. §8 gates the fill on fixture B only — A and C report it for information.
          Development only.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Browsing the app yourself?{" "}
          <Link className="font-semibold text-primary underline-offset-2 hover:underline" to="/inbox?fixture=busy">
            open it in busy
          </Link>
          {" · "}
          <Link className="font-semibold text-primary underline-offset-2 hover:underline" to="/inbox?fixture=sparse">
            sparse
          </Link>
          {" · "}
          <Link className="font-semibold text-primary underline-offset-2 hover:underline" to="/inbox?fixture=empty">
            empty
          </Link>
          {" · "}
          <Link className="font-semibold text-primary underline-offset-2 hover:underline" to="/inbox?fixture=off">
            back to real data
          </Link>
          . The choice sticks for the tab.
        </p>
      </header>

      <VoiceRippleLab />

      <KarmaGallery />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {SCREENS.map((s) => (
          <button
            key={s.path}
            type="button"
            onClick={() => setScreen(s.path)}
            data-testid={`lab-screen-${s.path.replace(/[^a-z]+/gi, "-")}`}
            className={`rounded-pill border px-3.5 text-sm font-semibold ${
              screen === s.path ? "border-transparent bg-primary text-primary-foreground" : "border-border bg-card"
            }`}
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            {s.label}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-border" />
        <button
          type="button"
          onClick={() => setShowBlocks((v) => !v)}
          data-testid="lab-toggle-blocks"
          className={`rounded-pill border px-3 text-sm font-semibold ${
            showBlocks ? "border-transparent bg-foreground text-background" : "border-border bg-card"
          }`}
          style={{ minHeight: "var(--control-h-sm)" }}
        >
          Blocks
        </button>
        {FIXTURE_NAMES.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() =>
              setStates((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))
            }
            data-testid={`lab-state-${f}`}
            className={`rounded-pill border px-3 text-sm font-semibold ${
              states.includes(f) ? "border-transparent bg-foreground text-background" : "border-border bg-card"
            }`}
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            {FIXTURE_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="flex gap-6 overflow-x-auto pb-4">
        {showBlocks && <BlockGallery />}
        {shown.map((f) => (
          <Frame key={`${screen}|${f}`} path={screen} fixture={f} />
        ))}
      </div>
    </div>
  );
}
