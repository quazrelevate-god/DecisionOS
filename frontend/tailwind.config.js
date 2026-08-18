/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
    theme: {
        extend: {
            /* RD-6 (2026-08-17) — the type scale, lifted.
               The redesign left the app at 424 `text-sm` (14px) and 322
               `text-xs` (12px) against only 36 `text-base` — i.e. almost every
               word on screen was 12-14px. On a 1400px desktop that reads as
               small and thin, which is what "not readable" meant.

               Rather than touch 746 call sites, the scale itself moves up one
               notch and every existing class inherits it. The named steps keep
               their names so nothing has to be renamed; only what they resolve
               to changes. Line-heights are set explicitly and generously —
               Tailwind's defaults tighten as size grows, which is right for
               headlines and wrong for the 15px body copy that carries this UI.

                 xs   12 -> 13   captions, meta, counts
                 sm   14 -> 15   the workhorse body size
                 base 16 -> 16   unchanged; card titles now land here
                 lg   18 -> 19
                 xl   20 -> 22
                 2xl  24 -> 27   stat values
                 3xl  30 -> 34
                 4xl  36 -> 42   serif page leads                            */
            fontSize: {
                'xs':   ['0.8125rem', { lineHeight: '1.45' }],   /* 13 */
                'sm':   ['0.9375rem', { lineHeight: '1.55' }],   /* 15 */
                'base': ['1rem',      { lineHeight: '1.6'  }],   /* 16 */
                'lg':   ['1.1875rem', { lineHeight: '1.5'  }],   /* 19 */
                'xl':   ['1.375rem',  { lineHeight: '1.4'  }],   /* 22 */
                '2xl':  ['1.6875rem', { lineHeight: '1.3'  }],   /* 27 */
                '3xl':  ['2.125rem',  { lineHeight: '1.2'  }],   /* 34 */
                '4xl':  ['2.625rem',  { lineHeight: '1.12' }],   /* 42 */
                '5xl':  ['3.25rem',   { lineHeight: '1.05' }],   /* 52 */
                '6xl':  ['4rem',      { lineHeight: '1'    }],   /* 64 */
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
                heading: ['Inter', 'system-ui', 'sans-serif'],
                // RD-1 (2026-08-17): the editorial display face. `font-display`
                // is for page-leading headings and greetings only — never UI
                // chrome, never below 24px. `font-heading` stays Inter so the
                // ~200 existing font-heading call sites keep their grotesque.
                display: ['Instrument Serif', 'ui-serif', 'Georgia', 'serif'],
                logo: ['Chivo', 'sans-serif'],
                mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
            },
            borderRadius: {
                // DS-1 gave the token file a real radius scale; these map onto
                // it. lg/md/sm keep pointing at --radius so every shadcn
                // component that hardcodes `rounded-md` stays consistent.
                lg: 'var(--radius)',
                md: 'var(--radius)',
                sm: 'var(--radius)',
                xl: 'var(--radius-xl)',
                pill: 'var(--radius-pill)',
            },
            // MPWA-01 (§5.1) — the mobile touch scale. 44 is the floor, 48 the
            // comfortable tier, 56 the money-committing tier (Approve/Reject).
            minHeight: {
                touch: '2.75rem',      // 44
                'touch-md': '3rem',    // 48
                'touch-lg': '3.5rem',  // 56
            },
            minWidth: {
                touch: '2.75rem',      // 44
                'touch-md': '3rem',    // 48
                'touch-lg': '3.5rem',  // 56
            },
            spacing: {
                'touch-gap': '0.5rem', // 8 — minimum gap between adjacent targets
            },
            colors: {
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
                popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
                primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
                secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
                muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
                accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
                destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                // MPWA-04 (§3.1) — the five semantic ramps, verbatim from the
                // spec's HSL triples. Additive: the existing brand.red/blue/
                // yellow/ink/paper keys stay, because ~1,900 call-sites use
                // them and this branch must not move desktop. New mobile
                // surfaces use the numeric steps.
                //
                // One job each (§3.1): brand = the action to take · danger =
                // money or a deadline at risk · caution = waiting on him ·
                // success = settled/received · neutral = everything else.
                // DS-2 — the ramps resolve through the token file, not through
                // literals here. index.css owns every value; this maps the
                // Tailwind names onto them, so a colour decision has exactly one
                // home and light/dark cannot drift apart.
                //
                // One job each: brand = the action to take · danger = money or a
                // deadline at risk · caution = waiting on him · success =
                // settled/received · neutral = everything else.
                brand: {
                    // `red` retired in the indigo rebrand — 271 sites -> brand-600, 58 -> danger-600.
                    // blue/yellow/ink/paper remain: they carry categorical meaning and need
                    // per-site mapping, not a swap. Tracked as rebrand phase 2.
                    blue: '#002FA7', yellow: '#FFCC00', ink: '#0A0A0B', paper: '#F4F4F5',
                    50: 'hsl(var(--brand-50))', 100: 'hsl(var(--brand-100))', 200: 'hsl(var(--brand-200))',
                    300: 'hsl(var(--brand-300))', 400: 'hsl(var(--brand-400))', 500: 'hsl(var(--brand-500))',
                    600: 'hsl(var(--brand-600))', 700: 'hsl(var(--brand-700))', 800: 'hsl(var(--brand-800))',
                    900: 'hsl(var(--brand-900))',
                },
                danger: {
                    50: 'hsl(var(--danger-50))', 100: 'hsl(var(--danger-100))', 200: 'hsl(var(--danger-200))',
                    300: 'hsl(var(--danger-300))', 400: 'hsl(var(--danger-400))', 500: 'hsl(var(--danger-500))',
                    600: 'hsl(var(--danger-600))', 700: 'hsl(var(--danger-700))', 800: 'hsl(var(--danger-800))',
                    900: 'hsl(var(--danger-900))',
                },
                caution: {
                    50: 'hsl(var(--caution-50))', 100: 'hsl(var(--caution-100))', 200: 'hsl(var(--caution-200))',
                    300: 'hsl(var(--caution-300))', 400: 'hsl(var(--caution-400))', 500: 'hsl(var(--caution-500))',
                    600: 'hsl(var(--caution-600))', 700: 'hsl(var(--caution-700))', 800: 'hsl(var(--caution-800))',
                    900: 'hsl(var(--caution-900))',
                },
                success: {
                    50: 'hsl(var(--success-50))', 100: 'hsl(var(--success-100))', 200: 'hsl(var(--success-200))',
                    300: 'hsl(var(--success-300))', 400: 'hsl(var(--success-400))', 500: 'hsl(var(--success-500))',
                    600: 'hsl(var(--success-600))', 700: 'hsl(var(--success-700))', 800: 'hsl(var(--success-800))',
                    900: 'hsl(var(--success-900))',
                },
                // DS-5 — the status-badge triples as first-class colours.
                //
                // StatusChip previously named ramp STEPS directly
                // (bg-caution-50 text-caution-800). A ramp step is a fixed
                // value, so in dark mode a "Waiting 1 day" chip kept its cream
                // background and amber text on a near-black card — unreadable,
                // and invisible to every check we have because nothing measures
                // contrast inside a chip. The --badge-* tokens carry a dark
                // override; naming them here is what makes the chip follow the
                // theme instead of the ramp.
                badge: {
                    pending:   { DEFAULT: 'hsl(var(--badge-pending-bg))',   fg: 'hsl(var(--badge-pending-fg))',   line: 'hsl(var(--badge-pending-bd))' },
                    directive: { DEFAULT: 'hsl(var(--badge-directive-bg))', fg: 'hsl(var(--badge-directive-fg))', line: 'hsl(var(--badge-directive-bd))' },
                    overdue:   { DEFAULT: 'hsl(var(--badge-overdue-bg))',   fg: 'hsl(var(--badge-overdue-fg))',   line: 'hsl(var(--badge-overdue-bd))' },
                    completed: { DEFAULT: 'hsl(var(--badge-completed-bg))', fg: 'hsl(var(--badge-completed-fg))', line: 'hsl(var(--badge-completed-bd))' },
                    neutral:   { DEFAULT: 'hsl(var(--badge-neutral-bg))',   fg: 'hsl(var(--badge-neutral-fg))',   line: 'hsl(var(--badge-neutral-bd))' },
                },
                // The urgency rail on a card's left edge (§2). Not yet used;
                // defined so a future rail reads a token rather than a ramp.
                edge: {
                    overdue: 'hsl(var(--edge-overdue))',
                    today:   'hsl(var(--edge-today))',
                    week:    'hsl(var(--edge-week))',
                    later:   'hsl(var(--edge-later))',
                },
                // Semantic surfaces + text, so a component can say what it means
                // rather than which grey it wants.
                surface: {
                    DEFAULT: 'hsl(var(--surface))',
                    raised:  'hsl(var(--surface-raised))',
                    sunken:  'hsl(var(--surface-sunken))',
                    hover:   'hsl(var(--surface-hover))',
                },
                hairline: { DEFAULT: 'hsl(var(--hairline))', strong: 'hsl(var(--hairline-strong))' },
                'brand-tint': {
                    DEFAULT: 'hsl(var(--brand-tint))',
                    hover:   'hsl(var(--brand-tint-hover))',
                    line:    'hsl(var(--brand-tint-border))',
                    fg:      'hsl(var(--brand-on-tint))',
                },
                neutral: {
                    50: 'hsl(var(--neutral-50))', 100: 'hsl(var(--neutral-100))', 200: 'hsl(var(--neutral-200))',
                    300: 'hsl(var(--neutral-300))', 400: 'hsl(var(--neutral-400))', 500: 'hsl(var(--neutral-500))',
                    600: 'hsl(var(--neutral-600))', 700: 'hsl(var(--neutral-700))', 800: 'hsl(var(--neutral-800))',
                    900: 'hsl(var(--neutral-900))',
                },
            },
            boxShadow: {
                /* RD-1 (2026-08-17): resting surfaces carry no shadow in the new
                   system — depth is the hairline. `brutal` and `brutal-sm` are
                   used as hover affordances across ~52 files, so rather than
                   touch every call site they are neutralised to `none` here and
                   removed opportunistically as each page is rebuilt. Only
                   `brutal-lg` keeps a shadow: it is on genuinely floating
                   surfaces (popovers, drawers) which must read as detached. */
                brutal: 'none',
                'brutal-sm': 'none',
                'brutal-lg': '0 16px 40px -12px rgba(12,12,20,.16), 0 4px 12px -4px rgba(12,12,20,.06)',
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
