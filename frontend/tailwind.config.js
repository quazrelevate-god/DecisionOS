/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
    theme: {
        extend: {
            // KM-0 (2026-08-27) — THE ONLY MOBILE BREAKPOINT.
            //
            // Below lg the content column is `.app-shell`, capped at
            // --app-shell (28rem/448px, index.css:134). It therefore stops
            // growing at a 480px VIEWPORT and sits at ~414px from 481 all the
            // way to 1023. `sm` (640) and `md` (768) both fire inside that
            // dead zone: there is no value either can set that corresponds to
            // more space, because there is no more space.
            //
            // So `sm:` and `md:` are BANNED inside the app shell — that is,
            // in anything rendered into <main> (src/pages/* except Landing,
            // Login, Signup and admin/*). Use `xs:` for the one real step
            // (320-399 -> 400-448) and `lg:` for desktop.
            //
            // They remain CORRECT, and are deliberately left working, for:
            //   · components/ui/* — dialog, sheet, toast, drawer, alert-dialog
            //     are portaled to document.body, OUTSIDE .app-shell, so their
            //     `sm:` really does measure the viewport;
            //   · /landing — not in the shell.
            // This is why `screens` sits inside `extend` rather than replacing
            // the default scale: redefining `sm` globally would stack every
            // dialog footer until 1024px.
            screens: {
                xs: '400px',
            },
            fontFamily: {
                // KR-1 (2026-08-18): one geometric voice. sans/heading/display
                // all resolve to Urbanist — the three keys survive because
                // hundreds of call sites reference them, but they are no longer
                // three faces. `display` keeps meaning "page-leading heading":
                // its weight/tracking voice lives in index.css (.font-display),
                // the family is just no longer a serif. `logo` is deleted
                // (zero call sites — the wordmark is a PNG). Mono stays for
                // genuine data: money columns, IDs, receipts.
                sans: ['Urbanist', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
                heading: ['Urbanist', 'system-ui', 'sans-serif'],
                display: ['Urbanist', 'system-ui', 'sans-serif'],
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
                // NM-1 — the soft-depth radius scale (§2): 14 controls,
                // 16 tiles, 20 cards. `cardlg`, not `card`: rounded-card would
                // shadow the card colour utilities' namespace in class names.
                control: 'var(--radius-control)',
                tile: 'var(--radius-tile)',
                cardlg: 'var(--radius-card)',
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
                // KR-2 — Karma's own names. ink = the band / active pill /
                // arrow buttons; accent = orange, ALERT GRAMMAR ONLY (deltas,
                // alert badges, chart markers) — never a button fill.
                kr: {
          brown: "hsl(var(--kr-brown))",
                    ink:    { DEFAULT: 'hsl(var(--kr-ink))', raised: 'hsl(var(--kr-ink-raised))' },
                    accent: { DEFAULT: 'hsl(var(--kr-accent))', soft: 'hsl(var(--kr-accent-soft))' },
                    outline: 'hsl(var(--kr-outline))',
                },
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
                /* NM-1 — the soft-depth recipes (§2). Values live in index.css;
                   these are names only, so light/dark/mobile variants flex in
                   one place. RD-1's "no shadow on resting surfaces" rule is
                   amended by NEUMORPHIC-REVAMP §0: furniture may now carry the
                   dual shadow, but always WITH the border-nm-edge hairline —
                   the shadow is atmosphere, the hairline is the boundary. */
                'nm-sm': 'var(--nm-shadow-sm)',
                nm: 'var(--nm-shadow-md)',
                'nm-lg': 'var(--nm-shadow-lg)',
                'nm-in': 'var(--nm-inset)',
                'nm-press': 'var(--nm-pressed)',
            },
            /* NM-1 — surface + edge names. backgroundColor/borderColor rather
               than `colors` so bg-nm cannot spawn text-nm/ring-nm variants
               nobody should use: the nm tokens are surfaces, not a palette. */
            backgroundColor: {
                nm: 'hsl(var(--nm-bg))',
                'nm-raised': 'hsl(var(--nm-raised))',
                'nm-sunken': 'hsl(var(--nm-sunken))',
                // NM-19: the rail is the one surface that is deliberately NOT
                // the page value. Its own name so no other component can drift
                // onto it by copying a class.
                'nm-rail': 'hsl(var(--nm-rail))',
            },
            borderColor: {
                'nm-edge': 'hsl(var(--nm-edge))',
                // KR-2: the control boundary — the token that carries WCAG
                // 1.4.11 in a language with no shadows and toneless borders
                // on containers. (Also under `colors` above for ring/text use.)
                'kr-outline': 'hsl(var(--kr-outline))',
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
