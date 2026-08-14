/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Geist', 'system-ui', 'sans-serif'],
                heading: ['Geist', 'system-ui', 'sans-serif'],
                logo: ['Chivo', 'sans-serif'],
                mono: ['IBM Plex Mono', 'monospace'],
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'var(--radius)',
                sm: 'var(--radius)',
                pill: '9999px',
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
                brand: {
                    red: '#FF3B30', blue: '#002FA7', yellow: '#FFCC00', ink: '#0A0A0B', paper: '#F4F4F5',
                    50: 'hsl(233 100% 97%)', 100: 'hsl(236 100% 94%)', 200: 'hsl(238 100% 89%)',
                    300: 'hsl(239 100% 82%)', 400: 'hsl(240 88% 71%)', 500: 'hsl(240 80% 61%)',
                    600: 'hsl(239 60% 51%)', 700: 'hsl(238 57% 41%)', 800: 'hsl(237 56% 33%)',
                    900: 'hsl(236 52% 26%)',
                },
                danger: {
                    50: 'hsl(0 86% 97%)', 100: 'hsl(0 93% 94%)', 200: 'hsl(0 96% 89%)',
                    300: 'hsl(0 94% 82%)', 400: 'hsl(0 91% 71%)', 500: 'hsl(0 84% 60%)',
                    600: 'hsl(0 72% 51%)', 700: 'hsl(0 74% 42%)', 800: 'hsl(0 70% 35%)',
                    900: 'hsl(0 63% 31%)',
                },
                caution: {
                    50: 'hsl(48 100% 96%)', 100: 'hsl(48 96% 89%)', 200: 'hsl(48 97% 77%)',
                    300: 'hsl(46 97% 65%)', 400: 'hsl(43 96% 56%)', 500: 'hsl(38 92% 50%)',
                    600: 'hsl(32 95% 44%)', 700: 'hsl(26 90% 37%)', 800: 'hsl(23 83% 31%)',
                    900: 'hsl(22 78% 26%)',
                },
                success: {
                    50: 'hsl(138 76% 97%)', 100: 'hsl(141 84% 93%)', 200: 'hsl(141 79% 85%)',
                    300: 'hsl(142 77% 73%)', 400: 'hsl(142 69% 58%)', 500: 'hsl(142 71% 45%)',
                    600: 'hsl(142 76% 36%)', 700: 'hsl(142 72% 29%)', 800: 'hsl(143 61% 24%)',
                    900: 'hsl(144 61% 20%)',
                },
                neutral: {
                    50: 'hsl(220 20% 98%)', 100: 'hsl(220 19% 95%)', 200: 'hsl(220 18% 90%)',
                    300: 'hsl(219 14% 81%)', 400: 'hsl(218 11% 65%)', 500: 'hsl(220 10% 43%)',
                    600: 'hsl(215 14% 34%)', 700: 'hsl(220 13% 26%)', 800: 'hsl(222 17% 11%)',
                    900: 'hsl(223 17% 8%)',
                },
            },
            boxShadow: {
                brutal: '0 1px 2px rgba(10,10,11,0.04), 0 4px 16px -6px rgba(10,10,11,0.08)',
                'brutal-sm': '0 1px 2px rgba(10,10,11,0.06)',
                'brutal-lg': '0 12px 32px -12px rgba(10,10,11,0.16)',
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
