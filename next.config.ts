import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  // Generation prints PDFs from the HTML templates (fonts included), which it reads at runtime.
  outputFileTracingIncludes: {
    "/api/extension/generation/artifacts": [
      "./public/resume-templates/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
