import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ── Shadcn-compatible semantic tokens ──────────────────────────────
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // ── Insurance domain tokens ─────────────────────────────────────
        // primary  → Trust/Brand  (Stellar Azure Blue — maps to --primary)
        // success  → Paid / Active policy
        // warning  → Pending / Under review
        // error    → Expired / Rejected
        success: {
          DEFAULT: 'hsl(142 71% 45%)',
          foreground: 'hsl(0 0% 100%)',
          subtle: 'hsl(142 71% 95%)',
        },
        warning: {
          DEFAULT: 'hsl(48 96% 53%)',
          foreground: 'hsl(0 0% 100%)',
          subtle: 'hsl(48 96% 95%)',
        },
        error: {
          DEFAULT: 'hsl(0 84% 60%)',
          foreground: 'hsl(0 0% 100%)',
          subtle: 'hsl(0 84% 96%)',
        },
      },

      // ── Typography scale for policy documents ──────────────────────────
      fontSize: {
        'policy-xs': ['0.75rem', { lineHeight: '1.5', letterSpacing: '0.01em' }],
        'policy-sm': ['0.875rem', { lineHeight: '1.6', letterSpacing: '0.01em' }],
        'policy-base': ['1rem', { lineHeight: '1.75', letterSpacing: '0' }],
        'policy-lg': ['1.125rem', { lineHeight: '1.75', letterSpacing: '-0.01em' }],
        'policy-xl': ['1.25rem', { lineHeight: '1.6', letterSpacing: '-0.02em' }],
      },

      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-ibm-mono)', 'monospace'],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
    },
  },
  plugins: [],
}

export default config
