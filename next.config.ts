import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  // Generation and the Resume page's download print PDFs from the HTML templates (fonts
  // included), which they read at runtime.
  outputFileTracingIncludes: Object.fromEntries(
    ["/api/extension/generation/artifacts", "/api/pdf/download"].map((route) => [
      route,
      ["./public/resume-templates/**/*", "./node_modules/@sparticuz/chromium/bin/**/*"],
    ]),
  ),
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
