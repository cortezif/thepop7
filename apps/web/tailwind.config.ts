import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          strong: "hsl(var(--primary-strong))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border))",
        ring: "hsl(var(--ring))",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          soft: "hsl(var(--accent-soft))",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        serif: ['"Playfair Display"', "Georgia", "serif"],
        display: ['"Playfair Display"', "Georgia", "serif"],
      },
      letterSpacing: {
        luxe: "0.28em",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(20,18,16,0.04), 0 8px 24px -12px rgba(20,18,16,0.10)",
        lift: "0 2px 4px rgba(20,18,16,0.05), 0 16px 40px -16px rgba(20,18,16,0.16)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
