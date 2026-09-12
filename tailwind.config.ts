import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Superficies: de la mas clara (fondo de pagina) a la mas contrastada.
        // Se conserva la escala numerica para no reescribir los componentes.
        surface: {
          950: '#eef2f7',
          900: '#ffffff',
          850: '#ffffff',
          800: '#f4f7fa',
          750: '#e9eef5',
          700: '#dbe3ec',
          600: '#c7d2de',
          500: '#b0bfd0',
        },
        ink: {
          DEFAULT: '#0f1c2e',
          muted: '#475569',
          faint: '#5b6a7e',
        },
        line: {
          DEFAULT: '#e2e8f0',
          strong: '#cbd5e1',
        },
        brand: {
          50: '#eef8fb',
          100: '#d3eef6',
          200: '#a9dded',
          300: '#4fc7de',
          400: '#22aecb',
          500: '#0d90ae',
          600: '#0a7391',
          700: '#0b5c75',
          800: '#0e4b5f',
          900: '#0f3e50',
        },
        status: {
          active: '#15803d',
          warning: '#b45309',
          dormant: '#dc2626',
          offline: '#64748b',
          moving: '#0e7490',
          idle: '#b45309',
        },
        overlay: 'rgba(15, 28, 46, 0.45)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        DEFAULT: '0.375rem',
      },
      boxShadow: {
        card: '0 1px 3px rgba(15, 28, 46, 0.07), 0 1px 2px rgba(15, 28, 46, 0.05)',
        float: '0 8px 24px rgba(15, 28, 46, 0.10), 0 2px 6px rgba(15, 28, 46, 0.06)',
        panel: '0 20px 50px rgba(15, 28, 46, 0.18), 0 4px 14px rgba(15, 28, 46, 0.08)',
        /** Halo de marca para CTAs y elementos destacados (login, upsell). */
        glow: '0 0 0 1px rgba(13, 144, 174, 0.18), 0 12px 32px rgba(13, 144, 174, 0.22)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.6' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 180ms cubic-bezier(0.22, 1, 0.36, 1)',
        'sheet-up': 'sheet-up 240ms cubic-bezier(0.22, 1, 0.36, 1)',
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
