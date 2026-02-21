/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Semantic tokens — resolved via CSS variables (light/dark)
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        accent: "var(--accent)",
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "#FFFFFF",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        error: {
          DEFAULT: "var(--error)",
          bg: "var(--error-bg)",
          light: "#fca5a5",
          bright: "#f87171",
        },
        info: "var(--info)",
        border: "var(--border)",
        ring: "var(--ring)",
        dimmed: "var(--dimmed)",

        // App-specific semantic aliases
        "header-bg": "var(--background)",
        "pressed-primary": "#3A3A3C",
        "light-foreground": "var(--foreground)",
        neutral: "var(--muted-foreground)",

        // Tool badge colors
        "tool-claude": "#C4704B",
        "tool-codex": "#10A37F",
        "tool-gemini": "#4285F4",
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "18px",
      },
    },
  },
  plugins: [],
};
