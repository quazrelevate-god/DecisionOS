// KR-8 · chartTheme — the bridge between the token file and Recharts.
//
// Recharts writes SVG presentation attributes, so it needs LITERALS — it
// cannot read `hsl(var(--kr-accent))`. This module resolves the tokens once
// per call from the live document, so a chart's colours come from the same
// single home as everything else (index.css) instead of a parallel palette.
// This is what retires Ledger.js's 12 hardcoded hexes.
//
// Resolved LAZILY (first call), not at module init: CRA guarantees CSS-before-
// JS in practice, but a lazy read costs nothing and can never race it.
let cache = null;

function readVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : fallback;
}

export function chartTheme() {
  if (cache) return cache;
  cache = {
    ink: readVar("--kr-ink", "#0C0C0D"),
    accent: readVar("--kr-accent", "#FF5100"),
    // On-ink chart chrome (the History band draws on the dark zone).
    onInk: {
      bar: "rgba(255,255,255,0.34)",
      barLine: "rgba(255,255,255,0.55)",
      tick: "rgba(255,255,255,0.55)",
      grid: "rgba(255,255,255,0.08)",
    },
    // On-light chart chrome (Finance donut / vendor bars in KR-10).
    onLight: {
      bar: "rgba(12,12,13,0.22)",
      barLine: "rgba(12,12,13,0.45)",
      tick: "rgba(12,12,13,0.55)",
      grid: "rgba(12,12,13,0.07)",
    },
  };
  return cache;
}

export default chartTheme;
