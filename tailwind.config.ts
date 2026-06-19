import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17201b",
        field: "#eef4ef",
        leaf: "#2f6b4f",
        mint: "#d9efe2",
        amber: "#f2b84b",
        clay: "#c76848",
        river: "#316b83"
      },
      boxShadow: {
        panel: "0 14px 40px rgba(23, 32, 27, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
