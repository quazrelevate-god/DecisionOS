/**
 * Tailwind is the *interface* to the design tokens, never a second source of truth.
 * Every value below points at a CSS custom property generated from
 * `src/lib/tokens.js` by `node scripts/gen-tokens.js`. If you need a new value,
 * add it to tokens.js and re-run the generator — do not hardcode it here.
 *
 * Colour is exposed BY ROLE (brand / danger / caution / success / neutral) so that
 * misuse is legible in the markup: `bg-danger-50` announces danger, and the raw
 * palette (`bg-red-50`) plus the legacy `brand-red/blue/yellow` keys are lint-banned
 * inside components/ds/**.
 */

/** `hsl(var(--x) / <alpha-value>)` keeps Tailwind's opacity modifiers working. */
const v = (name) => `hsl(var(--${name}) / <alpha-value>)`;

/** Emit a 50–900 role scale pointing at CSS vars. */
const scale = (role) =>
  Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [s, v(`${role}-${s}`)]));

/** Type step: size + leading + tracking + weight, all from vars. */
const type = (name) => [
  `var(--fs-${name})`,
  { lineHeight: `var(--lh-${name})`, letterSpacing: `var(--ls-${name})`, fontWeight: `var(--fw-${name})` },
];

/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
    theme: {
        extend: {
            fontFamily: {
                // One sans-serif for the entire system.
                sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
                heading: ['Inter', 'system-ui', 'sans-serif'],
                // Reserved for the Company Brain terminal block. Nowhere else.
                mono: ['IBM Plex Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
                // Legacy wordmark only; removed in the app-wide sweep.
                logo: ['Chivo', 'sans-serif'],
            },

            fontSize: {
                display: type('display'),
                h1: type('h1'),
                h2: type('h2'),
                h3: type('h3'),
                body: type('body'),
                'body-strong': type('body-strong'),
                small: type('small'),
                label: type('label'),
                badge: type('badge'),
                code: type('code'),
            },

            colors: {
                /* ---- Role scales: the primary colour API ---- */
                brand: {
                    ...scale('brand'),
                    /* Brand identity, insulated from the danger scale. Legal on
                       the wordmark and hero surfaces and nowhere else — the
                       brand artifacts (red app icon, red-and-black brochure)
                       settle that red is real identity here, while the UI
                       system keeps red for danger. `brand.red` is gone; the
                       legacy palette is fully dead. */
                    mark: v('brand-mark'),
                    hero: v('brand-hero'),
                },
                danger: scale('danger'),
                caution: scale('caution'),
                success: scale('success'),
                neutral: scale('neutral'),

                /* ---- Semantic surfaces & text ---- */
                background: v('background'),
                foreground: v('text-primary'),
                surface: {
                    DEFAULT: v('surface'),
                    raised: v('surface-raised'),
                    sunken: v('surface-sunken'),
                    hover: v('surface-hover'),
                },
                text: {
                    DEFAULT: v('text-primary'),
                    secondary: v('text-secondary'),
                    tertiary: v('text-tertiary'),
                    disabled: v('text-disabled'),
                    inverse: v('text-inverse'),
                },
                hairline: { DEFAULT: v('hairline'), strong: v('hairline-strong') },

                /* ---- The single primary action ---- */
                primary: {
                    DEFAULT: v('primary'),
                    hover: v('primary-hover'),
                    active: v('primary-active'),
                    tint: v('primary-tint'),
                    'tint-hover': v('primary-tint-hover'),
                    text: v('primary-text'),
                    foreground: v('on-primary'),
                },

                /* ---- Status: pale tint + dark coloured text ---- */
                status: {
                    'pending-bg': v('status-pending-bg'),
                    'pending-fg': v('status-pending-fg'),
                    'pending-line': v('status-pending-line'),
                    'directive-bg': v('status-directive-bg'),
                    'directive-fg': v('status-directive-fg'),
                    'directive-line': v('status-directive-line'),
                    'overdue-bg': v('status-overdue-bg'),
                    'overdue-fg': v('status-overdue-fg'),
                    'overdue-line': v('status-overdue-line'),
                    'completed-bg': v('status-completed-bg'),
                    'completed-fg': v('status-completed-fg'),
                    'completed-line': v('status-completed-line'),
                    'rejected-bg': v('status-rejected-bg'),
                    'rejected-fg': v('status-rejected-fg'),
                    'rejected-line': v('status-rejected-line'),
                },
                priority: {
                    'low-bg': v('priority-low-bg'),
                    'low-fg': v('priority-low-fg'),
                    'med-bg': v('priority-med-bg'),
                    'med-fg': v('priority-med-fg'),
                    'high-bg': v('priority-high-bg'),
                    'high-fg': v('priority-high-fg'),
                },

                /* ---- Grouped-feed urgency: left edge only ---- */
                urgency: {
                    overdue: v('urgency-overdue'),
                    today: v('urgency-today'),
                    week: v('urgency-week'),
                    later: v('urgency-later'),
                },

                /* ---- Company Brain terminal: dark in both themes ---- */
                terminal: {
                    DEFAULT: v('terminal-bg'),
                    raised: v('terminal-bg-raised'),
                    fg: v('terminal-fg'),
                    'fg-dim': v('terminal-fg-dim'),
                    label: v('terminal-label'),
                    accent: v('terminal-accent'),
                    hairline: v('terminal-hairline'),
                },

                /* ---- shadcn/ui compatibility: existing ui/* components read these ---- */
                card: { DEFAULT: v('card'), foreground: v('card-foreground') },
                popover: { DEFAULT: v('popover'), foreground: v('popover-foreground') },
                secondary: { DEFAULT: v('secondary'), foreground: v('secondary-foreground') },
                muted: { DEFAULT: v('muted'), foreground: v('muted-foreground') },
                accent: { DEFAULT: v('accent'), foreground: v('accent-foreground') },
                destructive: {
                    DEFAULT: v('danger'),
                    hover: v('danger-hover'),
                    tint: v('danger-tint'),
                    text: v('danger-text'),
                    line: v('danger-line'),
                    foreground: v('destructive-foreground'),
                },
                border: v('hairline'),
                input: v('input'),
                ring: v('ring'),
            },

            /** Fixed control heights from the spec: SM 32 / MD 40 / LG 48. */
            height: {
                'control-sm': 'var(--control-h-sm)',
                'control-md': 'var(--control-h-md)',
                'control-lg': 'var(--control-h-lg)',
            },
            width: {
                'control-sm': 'var(--control-h-sm)',
                'control-md': 'var(--control-h-md)',
                'control-lg': 'var(--control-h-lg)',
            },

            borderRadius: {
                sm: 'var(--radius-sm)',
                md: 'var(--radius-md)',
                lg: 'var(--radius-lg)',
                xl: 'var(--radius-xl)',
                pill: 'var(--radius-pill)',
            },

            borderWidth: {
                hairline: 'var(--border-hairline)',
                focus: 'var(--border-focus)',
            },

            ringWidth: { focus: 'var(--border-focus)' },

            boxShadow: {
                xs: 'var(--elevation-xs)',
                sm: 'var(--elevation-sm)',
                md: 'var(--elevation-md)',
                lg: 'var(--elevation-lg)',
            },

            keyframes: {
                'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
                'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
            },
            animation: {
                'accordion-down': 'accordion-down 0.2s ease-out',
                'accordion-up': 'accordion-up 0.2s ease-out',
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
};
