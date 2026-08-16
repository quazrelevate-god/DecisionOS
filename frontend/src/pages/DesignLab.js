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
import { Fire, Sun, Stamp, Star, Camera, CheckCircle } from "@phosphor-icons/react";

const SCREENS = [
  { path: "/inbox", label: "Desk · now" },
  { path: "/inbox?scope=morning", label: "Desk · morning" },
  { path: "/finance", label: "Money" },
  { path: "/my-work", label: "My Work" },
  { path: "/my-work?view=workflows", label: "My Work · board" },
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
        className="rounded-xl border border-border bg-card"
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
          <div className="rounded-xl border border-border bg-card p-3">
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

export default function DesignLab() {
  const [screen, setScreen] = useState(SCREENS[0].path);
  const [states, setStates] = useState(FIXTURE_NAMES);
  const [showBlocks, setShowBlocks] = useState(true);

  const shown = useMemo(() => FIXTURE_NAMES.filter((f) => states.includes(f)), [states]);

  return (
    <div className="min-h-screen bg-background p-6" data-testid="design-lab">
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
