import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: rootDirectory });

const config = [
  ...compat.extends("next/core-web-vitals"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "output/**",
      "playwright-report/**",
      "public/sw.js",
      "public/workbox-*.js",
      "public/swe-worker-*.js",
      "test-results/**",
    ],
  },
  {
    files: ["tests/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "@next/next/no-assign-module-variable": "off",
    },
  },
];

export default config;
