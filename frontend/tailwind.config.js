/** @type {import('tailwindcss').Config} */

/**
 * DecisionOS — "Meridian" design system (2026).
 *
 * Identity: warm paper + graphite ink + International Klein Blue as the single
 * system signature. Red is demoted from "the brand" to a pure urgency signal.
 * Depth comes from hairline borders and layered micro-shadows, never from hard
 * offset boxes.
 */
module.exports = {
    darkMode: ["class"],
    content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
    theme: {
        container: {
            center: true,
            padding: { DEFAULT: "1rem", lg: "2rem" },
            screens: { "2xl": "1440px" },
        },
        extend: {
            fontFamily: {
                sans: ['Geist', 'system-ui', '-apple-system', 'sans-serif'],
                heading: ['Geist', 'system-ui', 'sans-serif'],
                logo: ['Geist', 'system-ui', 'sans-serif'],
                mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
            },
            fontSize: {
                // Optical scale — tighter tracking as size grows.
                'display': ['2.75rem', { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '600' }],
                'title': ['1.75rem', { lineHeight: '1.15', letterSpacing: '-0.028em', fontWeight: '600' }],
                'heading': ['1.125rem', { lineHeight: '1.3', letterSpacing: '-0.018em', fontWeight: '600' }],
                'label': ['0.6875rem', { lineHeight: '1', letterSpacing: '0.11em', fontWeight: '500' }],
            },
            borderRadius: {
                sm: 'calc(var(--radius) - 6px)',
                md: 'calc(var(--radius) - 4px)',
                lg: 'var(--radius)',
                xl: 'calc(var(--radius) + 4px)',
                '2xl': 'calc(var(--radius) + 8px)',
            },
            colors: {
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                surface: {
                    DEFAULT: 'hsl(var(--surface))',
                    raised: 'hsl(var(--surface-raised))',
                    sunken: 'hsl(var(--surface-sunken))',
                },
                card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
                popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))',
                    subtle: 'hsl(var(--primary-subtle))',
                    emphasis: 'hsl(var(--primary-emphasis))',
                },
                secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
                muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
                accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
                destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))', subtle: 'hsl(var(--destructive-subtle))' },
                success: { DEFAULT: 'hsl(var(--success))', foreground: 'hsl(var(--success-foreground))', subtle: 'hsl(var(--success-subtle))' },
                warning: { DEFAULT: 'hsl(var(--warning))', foreground: 'hsl(var(--warning-foreground))', subtle: 'hsl(var(--warning-subtle))' },
                info: { DEFAULT: 'hsl(var(--info))', foreground: 'hsl(var(--info-foreground))', subtle: 'hsl(var(--info-subtle))' },
                border: 'hsl(var(--border))',
                'border-strong': 'hsl(var(--border-strong))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                sidebar: {
                    DEFAULT: 'hsl(var(--sidebar))',
                    foreground: 'hsl(var(--sidebar-foreground))',
                    muted: 'hsl(var(--sidebar-muted))',
                    border: 'hsl(var(--sidebar-border))',
                },
                // Signature palette. `gold` is the accent; `red` is retained ONLY
                // as the urgency signal. blue/yellow keys survive for un-migrated
                // markup — the legacy bridge in index.css re-tokens them anyway.
                brand: {
                    gold: '#D8B24A',
                    ink: '#0D0D0F',
                    graphite: '#4E4F55',
                    ivory: '#FFF4DE',
                    paper: '#FFF4DE',
                    red: '#E5342A',
                    blue: '#002FA7',
                    yellow: '#D97706',
                },
                chart: {
                    1: 'hsl(var(--chart-1))',
                    2: 'hsl(var(--chart-2))',
                    3: 'hsl(var(--chart-3))',
                    4: 'hsl(var(--chart-4))',
                    5: 'hsl(var(--chart-5))',
                },
            },
            boxShadow: {
                // Layered micro-depth. Light mode only — dark relies on borders.
                xs: '0 1px 2px -1px hsl(var(--shadow-color) / 0.08)',
                sm: '0 1px 2px -1px hsl(var(--shadow-color) / 0.07), 0 2px 6px -2px hsl(var(--shadow-color) / 0.05)',
                md: '0 2px 4px -2px hsl(var(--shadow-color) / 0.06), 0 8px 20px -8px hsl(var(--shadow-color) / 0.10)',
                lg: '0 4px 8px -4px hsl(var(--shadow-color) / 0.07), 0 16px 40px -16px hsl(var(--shadow-color) / 0.16)',
                // Inner highlight used to build crisp depth on dark surfaces.
                edge: 'inset 0 1px 0 0 hsl(var(--edge-highlight) / 0.06)',
                ring: '0 0 0 1px hsl(var(--border))',
                // Legacy aliases kept so un-migrated pages stay coherent.
                brutal: '0 1px 2px -1px hsl(var(--shadow-color) / 0.07), 0 2px 6px -2px hsl(var(--shadow-color) / 0.05)',
                'brutal-sm': '0 1px 2px -1px hsl(var(--shadow-color) / 0.08)',
                'brutal-lg': '0 4px 8px -4px hsl(var(--shadow-color) / 0.07), 0 16px 40px -16px hsl(var(--shadow-color) / 0.16)',
            },
            transitionTimingFunction: {
                out: 'cubic-bezier(0.16, 1, 0.3, 1)',
            },
            keyframes: {
                'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
                'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
                'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
                'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
                shimmer: { '100%': { transform: 'translateX(100%)' } },
                // The launcher rises from the bottom edge.
                'launcher-in': {
                    from: { opacity: '0', transform: 'translateY(24px) scale(0.985)' },
                    to: { opacity: '1', transform: 'translateY(0) scale(1)' },
                },
                // A single chevron drifting up and dissolving — the standing
                // invitation to swipe. Two of these, staggered, read as motion
                // without ever becoming a distraction.
                'hint-up': {
                    '0%': { opacity: '0', transform: 'translateY(3px)' },
                    '35%': { opacity: '0.9' },
                    '100%': { opacity: '0', transform: 'translateY(-5px)' },
                },
            },
            animation: {
                'accordion-down': 'accordion-down 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                'accordion-up': 'accordion-up 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                'fade-up': 'fade-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
                'fade-in': 'fade-in 0.25s ease-out both',
                // Registered here (not used as an arbitrary value) so Tailwind
                // actually emits the @keyframes block.
                shimmer: 'shimmer 1.6s infinite',
                'launcher-in': 'launcher-in 0.32s cubic-bezier(0.16, 1, 0.3, 1) both',
                'hint-up': 'hint-up 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
            },
        },
    },
    plugins: [require("tailwindcss-animate")],
};
