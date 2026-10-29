import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  // Server-side PDF printing (the Resume page download, and the Generation and Apply fallbacks that
  // /api/extension/generation/artifacts and /api/extension/apply/documents redirect here) reads the
  // HTML templates (fonts included) and Chromium at runtime. Only this route prints, so only this
  // function bundles them.
  outputFileTracingIncludes: {
    "/api/pdf/print": ["./public/resume-templates/**/*", "./node_modules/@sparticuz/chromium/bin/**/*"],
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
