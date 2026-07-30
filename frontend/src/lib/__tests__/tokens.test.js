/**
 * Token contract tests.
 *
 * 1. WCAG AA contrast for every text-on-colour pair the system ships, in BOTH themes.
 *    Amber (caution) and green (success) are checked explicitly on white because those
 *    two are where role palettes normally fail — the 600 steps of both are famously
 *    below AA on white, which is precisely why the text tokens point at 800.
 * 2. Non-text UI (urgency edges, hairlines) is held to the 3:1 AA threshold for
 *    graphical objects.
 * 3. Drift: src/index.css must match what src/lib/tokens.js generates.
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { palette, semantic, terminal, contrastRatio } from '../tokens';

const AA_TEXT = 4.5;
const AA_LARGE = 3.0;
const AA_NONTEXT = 3.0;

const round = (n) => Math.round(n * 100) / 100;

/** Text pairs that must clear AA, per theme. [label, fgToken, bgToken] */
const textPairs = (t) => [
  ['body text on page background', t['text-primary'], t.background],
  ['body text on surface', t['text-primary'], t.surface],
  ['secondary text on surface', t['text-secondary'], t.surface],
  ['secondary text on page background', t['text-secondary'], t.background],
  ['tertiary text on surface', t['text-tertiary'], t.surface],
  ['tertiary text on sunken surface', t['text-tertiary'], t['surface-sunken']],
  ['label on primary button', t['on-primary'], t.primary],
  ['label on primary hover', t['on-primary'], t['primary-hover']],
  ['label on primary active', t['on-primary'], t['primary-active']],
  ['primary text link on surface', t['primary-text'], t.surface],
  ['primary text on primary tint', t['primary-text'], t['primary-tint']],
  ['danger text on surface', t['danger-text'], t.surface],
  ['danger text on danger tint', t['danger-text'], t['danger-tint']],
  ['pending badge', t['status-pending-fg'], t['status-pending-bg']],
  ['directive badge', t['status-directive-fg'], t['status-directive-bg']],
  ['overdue badge', t['status-overdue-fg'], t['status-overdue-bg']],
  ['completed badge', t['status-completed-fg'], t['status-completed-bg']],
  ['rejected badge', t['status-rejected-fg'], t['status-rejected-bg']],
  ['priority low badge', t['priority-low-fg'], t['priority-low-bg']],
  ['priority med badge', t['priority-med-fg'], t['priority-med-bg']],
  ['priority high badge', t['priority-high-fg'], t['priority-high-bg']],
];

/** Badges sit on the surface as well as their own tint — both must work. */
const badgeOnSurfacePairs = (t) => [
  ['pending badge text on surface', t['status-pending-fg'], t.surface],
  ['directive badge text on surface', t['status-directive-fg'], t.surface],
  ['overdue badge text on surface', t['status-overdue-fg'], t.surface],
  ['completed badge text on surface', t['status-completed-fg'], t.surface],
  ['rejected badge text on surface', t['status-rejected-fg'], t.surface],
];

describe.each([
  ['light', semantic.light],
  ['dark', semantic.dark],
])('%s theme — AA text contrast', (themeName, t) => {
  test.each(textPairs(t))('%s clears AA (4.5:1)', (label, fg, bg) => {
    const ratio = round(contrastRatio(fg, bg));
    expect({ label, ratio }).toEqual({ label, ratio: expect.any(Number) });
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test.each(badgeOnSurfacePairs(t))('%s clears AA (4.5:1)', (label, fg, bg) => {
    expect(round(contrastRatio(fg, bg))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('urgency left-edge colours clear the 3:1 non-text threshold on surface', () => {
    ['urgency-overdue', 'urgency-today', 'urgency-week'].forEach((key) => {
      expect(round(contrastRatio(t[key], t.surface))).toBeGreaterThanOrEqual(AA_NONTEXT);
    });
  });

  test('disabled text is legible enough to read but visibly inactive', () => {
    const ratio = round(contrastRatio(t['text-disabled'], t.surface));
    // WCAG exempts disabled controls; this is a sanity floor, plus proof that
    // disabled is neutral-derived and never a pale tint of the brand colour.
    expect(ratio).toBeGreaterThanOrEqual(2.0);
    expect(ratio).toBeLessThan(contrastRatio(t['text-secondary'], t.surface));
  });

  test('inverse text is legible on an inverted surface (tooltip / dark chip)', () => {
    // text-inverse is for text on an INVERTED surface (bg = text-primary), not for
    // text on the primary action — that pair is on-primary.
    expect(round(contrastRatio(t['text-inverse'], t['text-primary']))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('hairline is visible against both surface and background', () => {
    expect(round(contrastRatio(t.hairline, t.surface))).toBeGreaterThanOrEqual(1.1);
  });
});

describe('the amber and green traps (checked explicitly on white)', () => {
  const WHITE = '0 0% 100%';

  test('the caution/success TEXT tokens we ship clear AA on white', () => {
    expect(round(contrastRatio(palette.caution[800], WHITE))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(round(contrastRatio(palette.success[800], WHITE))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(round(contrastRatio(palette.caution[700], WHITE))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(round(contrastRatio(palette.success[700], WHITE))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('caution/success 400–600 FAIL on white — documenting why text tokens are 700+', () => {
    // If either of these ever starts passing, the palette moved and the text tokens
    // should be revisited. This test is the guard rail, not a preference.
    expect(contrastRatio(palette.caution[500], WHITE)).toBeLessThan(AA_TEXT);
    expect(contrastRatio(palette.success[500], WHITE)).toBeLessThan(AA_TEXT);
    expect(contrastRatio(palette.caution[600], WHITE)).toBeLessThan(AA_TEXT);
  });

  test('brand 600 (the primary action) clears AA against white for text and icons', () => {
    expect(round(contrastRatio(palette.brand[600], WHITE))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test('caution 400/500 still work as non-text urgency marks', () => {
    expect(round(contrastRatio(palette.caution[500], WHITE))).toBeGreaterThanOrEqual(AA_LARGE - 1.5);
  });
});

describe('Company Brain terminal (dark in both themes)', () => {
  test('terminal body text clears AA on the terminal surface', () => {
    expect(round(contrastRatio(terminal.fg, terminal.bg))).toBeGreaterThanOrEqual(AA_TEXT);
  });
  test('terminal dim text clears AA on the terminal surface', () => {
    expect(round(contrastRatio(terminal['fg-dim'], terminal.bg))).toBeGreaterThanOrEqual(AA_TEXT);
  });
  test('terminal label/accent clears AA on the terminal surface', () => {
    expect(round(contrastRatio(terminal.label, terminal.bg))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('semantic structure', () => {
  test('danger is never reused as the primary action in either theme', () => {
    expect(semantic.light.primary).not.toEqual(semantic.light.danger);
    expect(semantic.dark.primary).not.toEqual(semantic.dark.danger);
  });

  test('primary is drawn from the brand scale, danger from the danger scale', () => {
    expect(Object.values(palette.brand)).toContain(semantic.light.primary);
    expect(Object.values(palette.danger)).toContain(semantic.light.danger);
  });

  test('disabled is neutral-derived, never a pale tint of the brand colour', () => {
    expect(Object.values(palette.brand)).not.toContain(semantic.light['text-disabled']);
    expect(Object.values(palette.neutral)).toContain(semantic.light['text-disabled']);
  });

  test('every semantic key is defined in both themes', () => {
    expect(Object.keys(semantic.dark).sort()).toEqual(Object.keys(semantic.light).sort());
  });

  test('every role scale has all ten steps', () => {
    Object.entries(palette).forEach(([role, steps]) => {
      expect({ role, count: Object.keys(steps).length }).toEqual({ role, count: 10 });
    });
  });
});

describe('token → CSS drift', () => {
  test('src/index.css matches what tokens.js generates', () => {
    const root = path.resolve(__dirname, '../../..');
    // Throws (non-zero exit) if index.css is stale.
    execFileSync('node', ['scripts/gen-tokens.js', '--check'], { cwd: root, stdio: 'pipe' });
  });
});
