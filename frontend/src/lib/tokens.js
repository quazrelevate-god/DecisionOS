/**
 * DecisionOS design tokens — SOURCE OF TRUTH.
 *
 * Every value here is measured from the Framer system reference
 * (https://simplest-person-653269.framer.app/decisionos-design-system), not invented.
 * The CSS custom properties in `src/index.css` are GENERATED from this file by
 * `node scripts/gen-tokens.js`; a test asserts they have not drifted. Never hand-edit
 * the generated block — change the tokens here and re-run the generator.
 *
 * Colour is role-based, never hue-based. The role names are the API:
 *   brand   — identity, active navigation, the single primary action
 *   danger  — errors, overdue work, destructive actions. NOTHING else.
 *   caution — pending, waiting for input, review holds
 *   success — done, verified, reconciled, closed
 *   neutral — the everyday system
 *
 * Values are stored as unquoted HSL triplets ("239 60% 51%") so they compose with
 * Tailwind's `hsl(var(--x) / <alpha-value>)` opacity syntax.
 *
 * @typedef {'brand'|'danger'|'caution'|'success'|'neutral'} ColorRole
 * @typedef {50|100|200|300|400|500|600|700|800|900} ColorStep
 */

/* ------------------------------------------------------------------------- *
 * 1. Palette — role scales
 * ------------------------------------------------------------------------- */

/**
 * Deep indigo. Anchored on measured values from the spec:
 * 50 #EEF0FF · 300 #A5A7FF · 500 #4E4FEB · 600 #3538CD · 700 #2D31A6 · 800 #252982.
 * 600 is the primary action; 700/800 are text-on-tint.
 */
const brand = {
  50: '233 100% 97%',
  100: '236 100% 94%',
  200: '238 100% 89%',
  300: '239 100% 82%',
  400: '240 88% 71%',
  500: '240 80% 61%',
  600: '239 60% 51%',
  700: '238 57% 41%',
  800: '237 56% 33%',
  900: '236 52% 26%',
};

/** Red. Danger only. Measured: 50 #FEF2F2 · 700 #B91C1C · 800 #991B1B. */
const danger = {
  50: '0 86% 97%',
  100: '0 93% 94%',
  200: '0 96% 89%',
  300: '0 94% 82%',
  400: '0 91% 71%',
  500: '0 84% 60%',
  600: '0 72% 51%',
  700: '0 74% 42%',
  800: '0 70% 35%',
  900: '0 63% 31%',
};

/** Amber. Waiting/pending. Measured: 50 #FFFBEB · 800 #92400E. */
const caution = {
  50: '48 100% 96%',
  100: '48 96% 89%',
  200: '48 97% 77%',
  300: '46 97% 65%',
  400: '43 96% 56%',
  500: '38 92% 50%',
  600: '32 95% 44%',
  700: '26 90% 37%',
  800: '23 83% 31%',
  900: '22 78% 26%',
};

/** Green. Completion only. Measured: 50 #F0FDF4 · 800 #166534. */
const success = {
  50: '138 76% 97%',
  100: '141 84% 93%',
  200: '141 79% 85%',
  300: '142 77% 73%',
  400: '142 69% 58%',
  500: '142 71% 45%',
  600: '142 76% 36%',
  700: '142 72% 29%',
  800: '143 61% 24%',
  900: '144 61% 20%',
};

/**
 * Cool-tinted neutral carrying the everyday system.
 * Measured: 200 #E1E4EA · 400 #9CA3AF · 600 #4B5563 · 700 #3A404C · 800 #181B22 · 900 #111318.
 */
const neutral = {
  50: '220 20% 98%',
  100: '220 19% 95%',
  200: '220 18% 90%',
  300: '219 14% 81%',
  400: '218 11% 65%',
  500: '220 10% 43%',
  600: '215 14% 34%',
  700: '220 13% 26%',
  800: '222 17% 11%',
  900: '223 17% 8%',
};

/**
 * The wordmark red — identity, and deliberately NOT part of the semantic system.
 *
 * It shares its hex with the old brand red, but not its name: a logo is not a
 * status, nobody reads a wordmark as danger, and the mark must not shift the
 * day someone retunes the danger scale. Legal to use in exactly one place: the
 * DecisionOS logo. Everything else that is red is danger.
 */
export const brandMark = '4 100% 59%';

export const palette = { brand, danger, caution, success, neutral };

/* ------------------------------------------------------------------------- *
 * 2. Semantic layer — paired light (canonical) + dark
 * ------------------------------------------------------------------------- */

const ref = (role, step) => palette[role][step];

/**
 * Light mode is canonical. Semantic surfaces use pale 50–100 backgrounds with
 * 700–800 text, per the spec.
 */
const light = {
  /* Surfaces */
  background: ref('neutral', 50),
  surface: '0 0% 100%',
  'surface-raised': '0 0% 100%',
  'surface-sunken': ref('neutral', 100),
  'surface-hover': ref('neutral', 50),

  /* Text */
  'text-primary': ref('neutral', 900),
  'text-secondary': ref('neutral', 600),
  'text-tertiary': ref('neutral', 500),
  'text-disabled': ref('neutral', 400),
  'text-inverse': '0 0% 100%',

  /* Lines */
  hairline: ref('neutral', 200),
  'hairline-strong': ref('neutral', 300),

  /* The single primary action */
  primary: ref('brand', 600),
  'primary-hover': ref('brand', 700),
  'primary-active': ref('brand', 800),
  'primary-tint': ref('brand', 50),
  'primary-tint-hover': ref('brand', 100),
  'primary-text': ref('brand', 700),
  'on-primary': '0 0% 100%',

  /* Danger — destructive/overdue/error only */
  danger: ref('danger', 600),
  'danger-hover': ref('danger', 700),
  'danger-tint': ref('danger', 50),
  'danger-text': ref('danger', 700),
  'danger-line': ref('danger', 300),

  /* Focus */
  ring: ref('brand', 600),

  /* Status badges: pale tint + dark colored text */
  'status-pending-bg': ref('caution', 50),
  'status-pending-fg': ref('caution', 800),
  'status-pending-line': ref('caution', 200),
  'status-directive-bg': ref('brand', 50),
  'status-directive-fg': ref('brand', 700),
  'status-directive-line': ref('brand', 200),
  'status-overdue-bg': ref('danger', 50),
  'status-overdue-fg': ref('danger', 800),
  'status-overdue-line': ref('danger', 200),
  'status-completed-bg': ref('success', 50),
  'status-completed-fg': ref('success', 800),
  'status-completed-line': ref('success', 200),

  /* Rejected — an outcome, not a failure. Neutral, and deliberately its own
     token rather than a reuse of priority/neutral so it can diverge later
     without anyone reaching for danger. */
  'status-rejected-bg': ref('neutral', 100),
  'status-rejected-fg': ref('neutral', 600),
  'status-rejected-line': ref('neutral', 200),

  /* Priority — deliberately NOT red; see PRIORITY note below */
  'priority-low-bg': ref('neutral', 50),
  'priority-low-fg': ref('neutral', 600),
  'priority-med-bg': ref('neutral', 100),
  'priority-med-fg': ref('neutral', 800),
  'priority-high-bg': ref('caution', 50),
  'priority-high-fg': ref('caution', 800),

  /* Grouped-feed urgency — LEFT EDGE ONLY, never a full-row fill */
  'urgency-overdue': ref('danger', 600),
  'urgency-today': ref('brand', 600),
  'urgency-week': ref('caution', 600),
  'urgency-later': ref('neutral', 300),
};

/** Dark counterparts. Tints become deep desaturated surfaces with light text. */
const dark = {
  background: ref('neutral', 900),
  surface: ref('neutral', 800),
  'surface-raised': '222 16% 14%',
  'surface-sunken': '223 17% 6%',
  'surface-hover': '222 15% 16%',

  'text-primary': ref('neutral', 50),
  'text-secondary': ref('neutral', 300),
  'text-tertiary': ref('neutral', 400),
  'text-disabled': '220 10% 40%',
  'text-inverse': ref('neutral', 900),

  hairline: '221 14% 20%',
  'hairline-strong': '221 13% 28%',

  primary: ref('brand', 500),
  // Deepen on hover/active rather than lighten: lightening past brand-500 drops
  // white label contrast below AA, and deepening matches light mode's 600→700→800.
  'primary-hover': '240 78% 55%',
  'primary-active': '239 70% 48%',
  'primary-tint': '238 45% 18%',
  'primary-tint-hover': '238 45% 23%',
  'primary-text': ref('brand', 300),
  'on-primary': '0 0% 100%',

  danger: ref('danger', 500),
  'danger-hover': ref('danger', 400),
  'danger-tint': '0 45% 15%',
  'danger-text': ref('danger', 300),
  'danger-line': '0 40% 32%',

  ring: ref('brand', 400),

  'status-pending-bg': '30 50% 13%',
  'status-pending-fg': ref('caution', 300),
  'status-pending-line': '30 40% 26%',
  'status-directive-bg': '238 45% 18%',
  'status-directive-fg': ref('brand', 300),
  'status-directive-line': '238 40% 32%',
  'status-overdue-bg': '0 45% 15%',
  'status-overdue-fg': ref('danger', 300),
  'status-overdue-line': '0 40% 30%',
  'status-completed-bg': '143 40% 13%',
  'status-completed-fg': ref('success', 300),
  'status-completed-line': '143 35% 26%',

  'status-rejected-bg': '221 15% 22%',
  'status-rejected-fg': ref('neutral', 300),
  'status-rejected-line': '221 13% 28%',

  'priority-low-bg': '222 15% 16%',
  'priority-low-fg': ref('neutral', 300),
  'priority-med-bg': '221 15% 22%',
  'priority-med-fg': ref('neutral', 50),
  'priority-high-bg': '30 50% 13%',
  'priority-high-fg': ref('caution', 300),

  'urgency-overdue': ref('danger', 500),
  'urgency-today': ref('brand', 400),
  'urgency-week': ref('caution', 400),
  'urgency-later': '221 13% 28%',
};

export const semantic = { light, dark };

/**
 * PRIORITY note (open question for review): the spec fixes red as danger-only but
 * also lists priority low/med/high on the status badge. High priority is not the
 * same claim as "overdue", so red is withheld here — high reads as caution, and
 * med/low as neutral weight. If high priority should genuinely mean danger, change
 * `priority-high-*` to the danger scale in this file only.
 */

/* ------------------------------------------------------------------------- *
 * 3. Terminal — the Company Brain block. Dark in BOTH themes.
 * The only place monospace is permitted anywhere in the system.
 * Measured: bg #111827 · fg #D1D5DB · label #A5ACFF.
 * ------------------------------------------------------------------------- */

export const terminal = {
  bg: '221 39% 11%',
  'bg-raised': '221 35% 15%',
  fg: '216 12% 84%',
  'fg-dim': '218 11% 65%',
  label: '235 100% 82%',
  accent: '235 100% 82%',
  hairline: '221 30% 22%',
};

/* ------------------------------------------------------------------------- *
 * 4. Typography — single sans (Inter) + IBM Plex Mono for the terminal only
 * Sizes/leading/tracking measured from the spec.
 * ------------------------------------------------------------------------- */

export const typography = {
  fonts: {
    sans: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  },
  /** [fontSize, { lineHeight, letterSpacing, fontWeight }] — Tailwind fontSize shape. */
  scale: {
    display: ['2.5rem', { lineHeight: '2.75rem', letterSpacing: '-0.025em', fontWeight: '700' }],
    h1: ['2rem', { lineHeight: '2.3rem', letterSpacing: '-0.022em', fontWeight: '700' }],
    h2: ['1.5rem', { lineHeight: '1.8125rem', letterSpacing: '-0.021em', fontWeight: '700' }],
    h3: ['1.125rem', { lineHeight: '1.4625rem', letterSpacing: '-0.04em', fontWeight: '600' }],
    body: ['0.9375rem', { lineHeight: '1.45rem', letterSpacing: '-0.02em', fontWeight: '400' }],
    'body-strong': ['0.9375rem', { lineHeight: '1.45rem', letterSpacing: '-0.02em', fontWeight: '600' }],
    small: ['0.8125rem', { lineHeight: '1.38rem', letterSpacing: '-0.01em', fontWeight: '400' }],
    label: ['0.6875rem', { lineHeight: '0.825rem', letterSpacing: '0.1em', fontWeight: '600' }],
    badge: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.042em', fontWeight: '600' }],
    code: ['0.8125rem', { lineHeight: '1.375rem', letterSpacing: '0', fontWeight: '400' }],
  },
  /** Numbers are always tabular so columns of figures align. */
  numeric: "'tnum' 1, 'lnum' 1",
};

/* ------------------------------------------------------------------------- *
 * 5. Space, radius, border, elevation
 * ------------------------------------------------------------------------- */

/** 4px base step. Control heights are fixed by the spec: SM 32 / MD 40 / LG 48. */
export const spacing = {
  0.5: '0.125rem',
  1: '0.25rem',
  1.5: '0.375rem',
  2: '0.5rem',
  2.5: '0.625rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
};

export const controlHeight = { sm: '2rem', md: '2.5rem', lg: '3rem' };

/** Card default is 12px per the spec. */
export const radius = {
  none: '0px',
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  pill: '999px',
};

export const border = { hairline: '1px', focus: '2px' };

/** Flat by default — depth comes from the hairline, not shadow. */
export const elevation = {
  none: 'none',
  xs: '0 1px 2px hsl(223 17% 8% / 0.04)',
  sm: '0 1px 2px hsl(223 17% 8% / 0.05), 0 1px 3px hsl(223 17% 8% / 0.04)',
  md: '0 2px 4px hsl(223 17% 8% / 0.04), 0 8px 20px -8px hsl(223 17% 8% / 0.10)',
  lg: '0 12px 32px -12px hsl(223 17% 8% / 0.16)',
};

/* ------------------------------------------------------------------------- *
 * 6. Colour maths — used by the contrast test and the gallery page
 * ------------------------------------------------------------------------- */

/**
 * Parse an unquoted HSL triplet into RGB 0–255.
 * @param {string} triplet e.g. "239 60% 51%"
 * @returns {[number, number, number]}
 */
export function hslTripletToRgb(triplet) {
  const [hRaw, sRaw, lRaw] = triplet.trim().split(/\s+/);
  const h = parseFloat(hRaw);
  const s = parseFloat(sRaw) / 100;
  const l = parseFloat(lRaw) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [r1 + m, g1 + m, b1 + m].map((v) => Math.round(v * 255));
}

/** @param {string} triplet @returns {string} uppercase hex, for display only. */
export function hslTripletToHex(triplet) {
  return `#${hslTripletToRgb(triplet).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** WCAG relative luminance. @param {string} triplet @returns {number} */
export function relativeLuminance(triplet) {
  const [r, g, b] = hslTripletToRgb(triplet).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio between two HSL triplets.
 * @param {string} a @param {string} b @returns {number} 1–21
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ------------------------------------------------------------------------- *
 * 7. CSS emission — consumed by scripts/gen-tokens.js and the drift test
 * ------------------------------------------------------------------------- */

const GEN_START = '/* === @generated design tokens — do not edit; run `node scripts/gen-tokens.js` === */';
const GEN_END = '/* === end @generated design tokens === */';

export const generatedMarkers = { start: GEN_START, end: GEN_END };

const emitVars = (entries, indent) =>
  entries.map(([k, v]) => `${indent}--${k}: ${v};`).join('\n');

const scaleEntries = (role) =>
  Object.entries(palette[role]).map(([step, v]) => [`${role}-${step}`, v]);

/**
 * Render the full token block that lives inside `src/index.css`.
 * @returns {string}
 */
export function renderTokenCss() {
  const i = '        ';
  const lines = [
    GEN_START,
    '@layer base {',
    '    :root {',
    `${i}/* Role scales */`,
    emitVars(scaleEntries('brand'), i),
    emitVars(scaleEntries('danger'), i),
    emitVars(scaleEntries('caution'), i),
    emitVars(scaleEntries('success'), i),
    emitVars(scaleEntries('neutral'), i),
    '',
    `${i}/* Semantic — light (canonical) */`,
    emitVars(Object.entries(light), i),
    '',
    `${i}/* Wordmark identity — not a semantic role; see brandMark */`,
    `${i}--brand-mark: ${brandMark};`,
    '',
    `${i}/* Company Brain terminal — dark in both themes */`,
    emitVars(Object.entries(terminal).map(([k, v]) => [`terminal-${k}`, v]), i),
    '',
    `${i}/* Type scale — Tailwind's text-* utilities read these */`,
    emitVars(
      Object.entries(typography.scale).flatMap(([k, [size, meta]]) => [
        [`fs-${k}`, size],
        [`lh-${k}`, meta.lineHeight],
        [`ls-${k}`, meta.letterSpacing],
        [`fw-${k}`, meta.fontWeight],
      ]),
      i
    ),
    `${i}--font-numeric: ${typography.numeric};`,
    '',
    `${i}/* Structure */`,
    emitVars(Object.entries(controlHeight).map(([k, v]) => [`control-h-${k}`, v]), i),
    emitVars(Object.entries(radius).map(([k, v]) => [`radius-${k}`, v]), i),
    `${i}--radius: ${radius.lg};`,
    `${i}--border-hairline: ${border.hairline};`,
    `${i}--border-focus: ${border.focus};`,
    emitVars(Object.entries(elevation).map(([k, v]) => [`elevation-${k}`, v]), i),
    '',
    `${i}/* shadcn/ui compatibility aliases — existing components read these */`,
    emitVars(
      [
        ['foreground', light['text-primary']],
        ['card', light.surface],
        ['card-foreground', light['text-primary']],
        ['popover', light.surface],
        ['popover-foreground', light['text-primary']],
        ['primary-foreground', light['on-primary']],
        ['secondary', light['surface-sunken']],
        ['secondary-foreground', light['text-primary']],
        ['muted', light['surface-sunken']],
        ['muted-foreground', light['text-secondary']],
        ['accent', light['surface-hover']],
        ['accent-foreground', light['text-primary']],
        ['destructive', light.danger],
        ['destructive-foreground', light['on-primary']],
        ['input', light.hairline],
      ],
      i
    ),
    '    }',
    '',
    '    .dark {',
    `${i}color-scheme: dark;`,
    `${i}/* Semantic — dark */`,
    emitVars(Object.entries(dark), i),
    '',
    emitVars(
      [
        ['foreground', dark['text-primary']],
        ['card', dark.surface],
        ['card-foreground', dark['text-primary']],
        ['popover', dark['surface-raised']],
        ['popover-foreground', dark['text-primary']],
        ['primary-foreground', dark['on-primary']],
        ['secondary', dark['surface-sunken']],
        ['secondary-foreground', dark['text-primary']],
        ['muted', dark['surface-sunken']],
        ['muted-foreground', dark['text-secondary']],
        ['accent', dark['surface-hover']],
        ['accent-foreground', dark['text-primary']],
        ['destructive', dark.danger],
        ['destructive-foreground', dark['on-primary']],
        ['input', dark.hairline],
      ],
      i
    ),
    '    }',
    '}',
    GEN_END,
  ];
  return lines.filter((l) => l !== null).join('\n');
}
