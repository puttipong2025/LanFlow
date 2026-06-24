import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  fallbacks: {
    document: "/offline.html",
  },
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    // Don't cache API requests with Cache First — use proper strategies
    runtimeCaching: [
      {
        // Never cache authenticated API responses in the shared service-worker
        // cache. Offline data is stored in a user-partitioned workspace instead.
        urlPattern: /^https?:\/\/.*\/api\/.*/i,
        handler: "NetworkOnly",
      },
      {
        // Static assets (JS/CSS/fonts): Cache First
        urlPattern: /\/_next\/static\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "lanflow-static-cache",
          expiration: {
            maxEntries: 128,
            maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
          },
        },
      },
      {
        // Images: Stale While Revalidate
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico)$/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "lanflow-images-cache",
          expiration: {
            maxEntries: 64,
            maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
          },
        },
      },
      {
        // Google Fonts stylesheets
        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "lanflow-google-fonts-cache",
          expiration: {
            maxEntries: 4,
            maxAgeSeconds: 60 * 60 * 24 * 365,
          },
        },
      },
      {
        // Google Fonts webfont files
        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "lanflow-gstatic-fonts-cache",
          expiration: {
            maxEntries: 4,
            maxAgeSeconds: 60 * 60 * 24 * 365,
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
};

export default withPWA(nextConfig);
