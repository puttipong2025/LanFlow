import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#203028",
        field: "#edf3f0",
        leaf: "#2f7d5c",
        mint: "#d7e5df",
        amber: "#9a631c",
        clay: "#a94f45",
        river: "#28776f",
        success: "#2f7d5c",
        danger: "#b33f4a",
        commit: "#3d73a3",
        actionSecondary: "#586a7c",
        settings: "#58697f",
        telegram: "#087ab8",
        stockAdd: "#6b59a5",
        stockMove: "#a85f2b",
        sand: "#f9faf9",
      },
      borderRadius: {
        md: "0.625rem",
        lg: "0.875rem",
      },
      boxShadow: {
        panel: "0 1px 2px rgba(32, 48, 40, 0.04), 0 10px 28px rgba(32, 48, 40, 0.07)",
      }
    }
  },
  plugins: []
};

export default config;
