import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
      },
      colors: {
        bg: {
          DEFAULT: "#05070d",
          soft: "#0a0f1c",
          card: "rgba(15, 23, 42, 0.55)",
        },
        neon: {
          cyan: "#22d3ee",
          purple: "#a855f7",
          pink: "#ec4899",
          green: "#22c55e",
          yellow: "#facc15",
          red: "#ef4444",
        },
      },
      boxShadow: {
        glow: "0 0 25px rgba(34, 211, 238, 0.35), 0 0 50px rgba(168, 85, 247, 0.25)",
        "glow-sm": "0 0 12px rgba(34, 211, 238, 0.45)",
        "glow-purple": "0 0 25px rgba(168, 85, 247, 0.45)",
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(34,211,238,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.06) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(60% 60% at 50% 0%, rgba(34,211,238,0.25) 0%, rgba(168,85,247,0.12) 40%, transparent 70%)",
      },
      animation: {
        "pulse-glow": "pulseGlow 2.4s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
      },
      keyframes: {
        pulseGlow: {
          "0%,100%": { opacity: "1", boxShadow: "0 0 8px rgba(34,197,94,0.7)" },
          "50%": { opacity: "0.7", boxShadow: "0 0 18px rgba(34,197,94,1)" },
        },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
