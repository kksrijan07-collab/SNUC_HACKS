/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],

  theme: {
    extend: {
      // ── SYNCRO design tokens ──────────────────────────────────────────────
      colors: {
        // Base surfaces
        "void":     "#060609",
        "surface":  "#0a0a0f",
        "elevated": "#0f0f1a",
        "border":   "#1e1e2e",

        // Proof-of-Work signal colours
        "pow-green":  "#00ff87",
        "pow-yellow": "#ffd60a",
        "pow-red":    "#ff3131",
        "pow-blue":   "#00c7ff",
        "pow-purple": "#a78bfa",

        // Text
        "text-primary":   "#ffffff",
        "text-secondary": "#e0e0e0",
        "text-muted":     "#888888",
        "text-faint":     "#555555",
      },

      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "'Courier New'", "monospace"],
      },

      fontSize: {
        "2xs": ["0.60rem", { lineHeight: "1rem" }],
        "xs":  ["0.68rem", { lineHeight: "1.1rem" }],
        "sm":  ["0.75rem", { lineHeight: "1.2rem" }],
      },

      borderRadius: {
        "2xl": "12px",
        "xl":  "10px",
        "lg":  "8px",
      },

      boxShadow: {
        "pow":       "0 0 16px rgba(0, 255, 135, 0.18)",
        "pow-red":   "0 0 16px rgba(255, 49, 49,  0.18)",
        "pow-inner": "inset 0 1px 0 rgba(255,255,255,0.04)",
      },

      keyframes: {
        "shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%":      { transform: "translateX(-6px)" },
          "40%":      { transform: "translateX(6px)" },
          "60%":      { transform: "translateX(-4px)" },
          "80%":      { transform: "translateX(4px)" },
        },
        "flash-out": {
          "to": { opacity: "0" },
        },
        "spin-slow": {
          "to": { transform: "rotate(360deg)" },
        },
        "pulse-ring": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(0,255,135,0.4)" },
          "50%":      { boxShadow: "0 0 0 6px rgba(0,255,135,0)" },
        },
      },

      animation: {
        "shake":       "shake 0.5s ease",
        "flash-out":   "flash-out 0.8s ease forwards",
        "spin-slow":   "spin-slow 0.7s linear infinite",
        "pulse-ring":  "pulse-ring 2s ease infinite",
      },

      backgroundImage: {
        "glow-green":  "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(0,255,135,0.06) 0%, transparent 70%)",
        "card-sheen":  "linear-gradient(135deg, rgba(255,255,255,0.025), transparent)",
      },
    },
  },

  plugins: [],
};
