/* DESK TYPE — fifteen ways the phone Desk could read. (2026-10-12)
 *
 * The client, on the home screen at 6.1": the type is too thin and too small
 * to read. Measured in the 390x844 frame, ON THE GLASS (the phone runs at
 * --ui-scale 0.8, ASK-43, so every CSS px is drawn at 0.8):
 *   KPI labels 11.2px/400 · dock labels 10.4px · decision meta 12px/400 ·
 *   decision titles 13.6px/500 · "/100" and "All moving" 11.2px.
 * Urbanist is a geometric face with a small x-height and light strokes, so at
 * those sizes it reads smaller and thinner than the numbers say.
 *
 * NOTHING HERE TOUCHES THE APP. Each frame is the real Desk (/inbox, busy
 * fixture) in its own iframe, and the variant is a <link> and a <style>
 * written into THAT frame's document only: a font from Google Fonts, a type
 * scale, weights, line heights, tracking, and the spacing of the KPI tiles,
 * the sheet, the decision pills and the dock. The fonts are fetched only while
 * this owner-only page is open; the app itself still carries its own two
 * faces and calls no font service (src/fonts.css). Once one is chosen it gets
 * bundled like Urbanist and written into index.css / tailwind.config.js.
 *
 * Row type keeps the Desk's own fit machinery: sizes are written as
 * `N px × var(--desk-row-scale)`, so a short phone still shrinks the rows to
 * fit (index.css, "The sheet's rows") instead of overflowing them.
 */
import { useCallback, useRef, useState } from "react";

const VW = 390;
const VH = 844;
const GLASS = 0.8; // --ui-scale on a phone (ASK-43)
const SRC = "/inbox?fixture=busy";

/* Type scales, in CSS px (the frame draws them at 0.8). Today's Desk, for the
   record: greeting 26.4, title 17, meta 15, KPI label 14, tab 14, dock 13. */
const SIZE = {
  S: { greeting: 28, score: 56, kpiNum: 36, label: 15.5, small: 15, tab: 15.5, title: 18.5, meta: 16, amount: 16.5, button: 16, dock: 14 },
  M: { greeting: 29, score: 56, kpiNum: 38, label: 16.5, small: 15.5, tab: 16, title: 19.5, meta: 16.5, amount: 17, button: 16.5, dock: 14.5 },
  L: { greeting: 30, score: 58, kpiNum: 40, label: 17, small: 16, tab: 17, title: 20.5, meta: 17.5, amount: 18, button: 17, dock: 15 },
};

/* Spacing profiles, CSS px. Today: tile 12 pad, KPI gap 10, pill 8×14,
   pill gap 10, sheet 16 in from the edge. */
const SPACE = {
  tight:    { kpiGap: 8,  tilePad: 12, tileR: 20, sheetX: 14, listGap: 8,  pillY: 8,  pillX: 14, pillR: 18, lineGap: 2, pageGap: 12 },
  balanced: { kpiGap: 10, tilePad: 14, tileR: 22, sheetX: 16, listGap: 10, pillY: 10, pillX: 16, pillR: 20, lineGap: 4, pageGap: 14 },
  airy:     { kpiGap: 12, tilePad: 16, tileR: 24, sheetX: 16, listGap: 12, pillY: 12, pillX: 18, pillR: 22, lineGap: 6, pageGap: 16 },
};

const W = {
  regular: { body: 500, label: 500, title: 600, strong: 600, num: 600, display: 600 },
  sturdy:  { body: 500, label: 600, title: 600, strong: 700, num: 700, display: 700 },
  light:   { body: 400, label: 500, title: 600, strong: 600, num: 600, display: 600 },
};

const v = (id, name, gf, why, size, space, weights, extra = {}) => ({
  id, name, gf, why, size, space, weights,
  lh: { title: 1.25, meta: 1.3, label: 1.25, ...(extra.lh || {}) },
  track: { body: "0", title: "-0.005em", display: "-0.02em", ...(extra.track || {}) },
});

/* Fifteen faces, chosen for one job: small text on a phone. Large x-heights,
   open apertures, sturdy strokes at 500 — and none of them a second Urbanist. */
export const DESK_TYPE_VARIANTS = [
  v(1, "Inter", "Inter:wght@400;500;600;700", "The screen-UI workhorse: tall x-height, built for small sizes. The safe, neutral pick.", "M", "balanced", W.regular, { track: { title: "-0.011em" } }),
  v(2, "Plus Jakarta Sans", "Plus+Jakarta+Sans:wght@400;500;600;700", "Modern and friendly, still geometric like today — but heavier strokes and a bigger x-height.", "M", "balanced", W.regular),
  v(3, "Manrope", "Manrope:wght@400;500;600;700;800", "Semi-condensed and precise; fits more words per row at a bigger size. Good for long decision titles.", "L", "balanced", W.sturdy),
  v(4, "DM Sans", "DM+Sans:wght@400;500;600;700", "Low-contrast geometric with open counters. The closest in mood to Urbanist, without the thinness.", "L", "balanced", W.regular),
  v(5, "Figtree", "Figtree:wght@400;500;600;700;800", "Clean and warm; very even colour at 500, so meta lines stay readable on the black sheet.", "M", "airy", W.regular),
  v(6, "Lexend", "Lexend:wght@400;500;600;700", "Designed to reduce reading effort. Wide letters, so it is set a step smaller and tracked tight.", "S", "balanced", W.light, { track: { body: "-0.01em", title: "-0.015em" } }),
  v(7, "Nunito Sans", "Nunito+Sans:wght@400;500;600;700;800", "Rounded terminals, soft and legible; reads well at 12–13px on the glass.", "L", "airy", W.sturdy),
  v(8, "Source Sans 3", "Source+Sans+3:wght@400;500;600;700", "Adobe's UI face: compact, very clear in long lists; tall line metrics, so it sits on the medium scale.", "M", "tight", W.sturdy, { lh: { title: 1.18, meta: 1.22, label: 1.32 } }),
  v(9, "IBM Plex Sans", "IBM+Plex+Sans:wght@400;500;600;700", "Business-serious and very legible; pairs with the IBM Plex Mono already used for money.", "M", "balanced", W.regular),
  v(10, "Work Sans", "Work+Sans:wght@400;500;600;700", "Slightly wide grotesk optimised for on-screen text at medium sizes.", "M", "balanced", W.regular),
  v(11, "Outfit", "Outfit:wght@400;500;600;700", "Geometric like Urbanist, but a sturdier skeleton — the gentlest change from today.", "L", "balanced", W.sturdy),
  v(12, "Poppins", "Poppins:wght@400;500;600;700", "Very familiar to Indian users; big round letters. Wide, so set at the small scale.", "S", "balanced", W.light, { track: { body: "-0.005em", title: "-0.01em" } }),
  v(13, "Hanken Grotesk", "Hanken+Grotesk:wght@400;500;600;700", "Crisp neo-grotesk with good weight at 500; numbers stay compact in the KPI tiles.", "L", "airy", W.regular),
  v(14, "Onest", "Onest:wght@400;500;600;700", "Built for interfaces: generous spacing, clear numerals, calm at every size.", "M", "balanced", W.regular),
  v(15, "Atkinson Hyperlegible Next", "Atkinson+Hyperlegible+Next:wght@400;500;600;700", "Designed for low-vision readers: every letter distinct (Il1, 0O). Maximum legibility.", "L", "airy", W.regular),
];

const fontHref = (gf) => `https://fonts.googleapis.com/css2?family=${gf}&display=swap`;

/** The variant as CSS, scoped to the Desk's own hooks (data-testid + kr-desk-*). */
export function deskTypeCss(variant) {
  const s = SIZE[variant.size];
  const sp = SPACE[variant.space];
  const w = variant.weights;
  const { lh, track } = variant;
  const fam = `'${variant.name}', system-ui, sans-serif`;
  const row = (px) => `calc(${px}px * var(--desk-row-scale))`;
  return `
html body, html body *:not(svg):not(svg *) { font-family: ${fam} !important; }
[data-testid="desk-page"], [data-testid="dock-slider"] { font-weight: ${w.body}; letter-spacing: ${track.body}; }
[data-testid="desk-page"] { gap: ${sp.pageGap}px !important; }

/* greeting + score */
[data-testid="desk-brief-greeting"] { font-size: ${s.greeting}px !important; line-height: 1.12 !important; letter-spacing: ${track.display} !important; }
[data-testid="desk-brief-greeting"] span { font-weight: ${w.display} !important; }
[data-testid="desk-score-link-phone"] .font-display { font-size: ${s.score}px !important; font-weight: ${w.num} !important; letter-spacing: ${track.display} !important; }
[data-testid="desk-score-link-phone"] .text-sm { font-size: ${s.small}px !important; font-weight: ${w.label} !important; }

/* KPI tiles */
[data-testid="desk-kpi-grid"] { gap: ${sp.kpiGap}px !important; }
[data-testid="desk-kpi-grid"] .kr-kpi-tile { padding: ${sp.tilePad}px !important; border-radius: ${sp.tileR}px !important; }
[data-testid="desk-kpi-grid"] .text-4xl { font-size: ${s.kpiNum}px !important; font-weight: ${w.num} !important; letter-spacing: ${track.display} !important; }
[data-testid="desk-kpi-grid"] .text-lg { font-size: ${Math.round(s.kpiNum * 0.5)}px !important; }
[data-testid="desk-kpi-grid"] .text-sm,
[data-testid="desk-kpi-grid"] .kr-stat__label { font-size: ${s.label}px !important; line-height: ${lh.label} !important; font-weight: ${w.label} !important; }
[data-testid="kpi-workflows-open"] { font-size: ${s.button}px !important; font-weight: ${w.strong} !important; }
/* The label sits BESIDE the 32px icon today, which leaves it ~52px of a
   117px tile: at a readable size "Complaints" becomes "Complai". It moves
   under the icon here and gets the tile's whole width. */
[data-testid="desk-kpi-grid"] > a.kr-kpi-tile > div:first-child { flex-wrap: wrap; row-gap: ${sp.lineGap + 6}px; }
[data-testid="desk-kpi-grid"] > a.kr-kpi-tile > div:first-child > p { flex-basis: 100%; }

/* the sheet: tabs, pills, show all */
.kr-desk-board { padding-inline: ${sp.sheetX}px !important; }
[data-testid^="desk-tab-"]:not([data-testid="desk-tab-slider"]) { font-size: ${s.tab}px !important; font-weight: ${w.strong} !important; }
.kr-desk-sheet-list { --desk-row-gap: ${sp.listGap}px !important; gap: var(--desk-row-gap) !important; }
.kr-desk-pill { padding-inline: ${sp.pillX}px !important; border-radius: ${sp.pillR}px !important; }
.kr-desk-row-roomy { padding-block: ${row(sp.pillY)} !important; }
.kr-desk-pill > div:first-child { gap: ${sp.lineGap}px !important; }
.kr-desk-row-title { font-size: ${row(s.title)} !important; line-height: ${row(s.title * lh.title)} !important; font-weight: ${w.title} !important; letter-spacing: ${track.title} !important; }
.kr-desk-row-meta { font-size: ${row(s.meta)} !important; line-height: ${row(s.meta * lh.meta)} !important; font-weight: ${w.body} !important; }
.kr-desk-row-amount { font-size: ${row(s.amount)} !important; font-weight: ${w.title} !important; font-variant-numeric: tabular-nums; }
[data-testid="desk-phone-more"] { font-size: ${s.tab}px !important; font-weight: ${w.strong} !important; }

/* dock */
[data-testid="dock-slider"] { --text-label: ${s.dock}px; }
[data-testid="dock-slider-items"] * { font-weight: ${w.strong}; }
`;
}

/** What the type comes to on a real phone (CSS px × 0.8), for the caption. */
const glass = (px) => (px * GLASS).toFixed(1).replace(/\.0$/, "");

function TypeFrame({ variant }) {
  const ref = useRef(null);
  const [state, setState] = useState("loading");

  const apply = useCallback(() => {
    const frame = ref.current;
    const d = frame?.contentDocument;
    if (!d || !variant) { setState("ready"); return; }
    try {
      if (!d.getElementById("tv-font")) {
        const link = d.createElement("link");
        link.id = "tv-font";
        link.rel = "stylesheet";
        link.href = fontHref(variant.gf);
        d.head.appendChild(link);
      }
      let style = d.getElementById("tv-style");
      if (!style) {
        style = d.createElement("style");
        style.id = "tv-style";
        d.head.appendChild(style);
      }
      style.textContent = deskTypeCss(variant);
      /* The Desk measures its rows to fit them (--desk-row-scale,
         data-desk-tight). New type changes what fits, so once the face has
         arrived ask it to measure again. */
      const remeasure = () => frame.contentWindow?.dispatchEvent(new Event("resize"));
      (d.fonts?.ready || Promise.resolve()).then(() => { remeasure(); setTimeout(remeasure, 400); });
      setState("ready");
    } catch (e) {
      setState("failed");
    }
  }, [variant]);

  const s = variant ? SIZE[variant.size] : null;
  const sp = variant ? SPACE[variant.space] : null;

  return (
    <figure className="m-0 shrink-0" style={{ width: VW }} data-testid={`desk-type-${variant ? variant.id : "today"}`}>
      <figcaption className="mb-2 min-h-[7.5rem]">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {variant ? `Variation ${variant.id} · ${variant.size} type · ${variant.space}` : "Shipped · variation 7 since 2026-10-12"}
        </p>
        <p className="mt-0.5 text-lg font-semibold tracking-tight">{variant ? variant.name : "The app as it is"}</p>
        <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
          {variant ? variant.why : "Nunito Sans with variation 7's sizes and spacing, now in the app itself (index.css). Before that, Urbanist: the face the client found thin."}
        </p>
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {variant
            ? <>on the glass: title {glass(s.title)} · meta {glass(s.meta)} · label {glass(s.label)} · dock {glass(s.dock)} · weights {variant.weights.body}/{variant.weights.title}<br />pill {sp.pillY}×{sp.pillX} · gap {sp.listGap} · tile {sp.tilePad}</>
            : <>was (Urbanist): title 13.6 · meta 12 · label 11.2 · dock 10.4 · weights 400/500<br />pill 8×14 · gap 10 · tile 12</>}
        </p>
      </figcaption>
      <div className="relative overflow-hidden rounded-[28px] border border-border bg-black shadow-sm" style={{ width: VW, height: VH }}>
        <iframe
          ref={ref}
          title={variant ? `Desk in ${variant.name}` : "Desk today"}
          src={SRC}
          width={VW}
          height={VH}
          loading="lazy"
          onLoad={apply}
          className="block border-0"
        />
        {state === "failed" && (
          <p className="absolute inset-x-0 bottom-0 bg-black/80 p-2 text-center text-xs text-white">Could not apply this variation</p>
        )}
      </div>
    </figure>
  );
}

export default function DeskTypeLab() {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-10" data-testid="lab-desk-type">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="font-heading text-lg font-semibold">Desk type · 15 variations (phone, 390×844)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The client finds the phone Desk&rsquo;s type too thin and too small. Each frame is the real
            Desk on the busy fixture with a different face, type scale, weights, line heights and spacing
            (KPI tiles, the sheet, the decision pills, the dock) applied inside that frame only — the app
            is unchanged. Sizes in the captions are what lands on the glass at the phone&rsquo;s 0.8 scale.
            Fonts load from Google Fonts on this page only.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((x) => !x)}
          data-testid="lab-desk-type-toggle"
          className="rounded-pill border border-border bg-card px-3.5 text-sm font-semibold"
          style={{ minHeight: "var(--control-h-sm)" }}
        >
          {open ? "Hide" : "Show"} variations
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-x-6 gap-y-10">
          <TypeFrame variant={null} />
          {DESK_TYPE_VARIANTS.map((variant) => <TypeFrame key={variant.id} variant={variant} />)}
        </div>
      )}
    </section>
  );
}
