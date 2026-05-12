import type { Config } from 'tailwindcss';

export default {
    darkMode: 'class',
    content: ['./src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                main: 'hsl(var(--main))',
                'main-foreground': 'hsl(var(--main-foreground))',
                bg: 'hsl(var(--bg))',
                fg: 'hsl(var(--fg))',
                muted: 'hsl(var(--muted))',
                'muted-foreground': 'hsl(var(--muted-foreground))',
                surface: 'hsl(var(--surface))',
                border: 'hsl(var(--border))',
                brand: {
                    blue: '#274DD7',
                    navy: '#1A2051',
                    yellow: '#F1B244',
                    coral: '#F87171',
                    mint: '#86EFAC',
                    pink: '#F9A8D4',
                    cream: '#FFF8EB',
                },
            },
            borderRadius: {
                xl: '16px',
                '2xl': '20px',
                '3xl': '28px',
                pill: '9999px',
            },
            boxShadow: {
                card: '0 4px 16px rgba(26, 32, 81, 0.08)',
                'card-lg': '0 8px 32px rgba(26, 32, 81, 0.12)',
                pop: '0 12px 40px rgba(26, 32, 81, 0.18)',
            },
            fontFamily: {
                sans: ['"Nunito Variable"', 'Nunito', 'system-ui', 'sans-serif'],
            },
        },
    },
    plugins: [],
} satisfies Config;
