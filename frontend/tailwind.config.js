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
                brand: { red: '#FF3B30', blue: '#002FA7', yellow: '#FFCC00', ink: '#0A0A0B', paper: '#F4F4F5' },
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
