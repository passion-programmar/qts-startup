import type { NextConfig } from "next";

const templateFontPackages = ["arimo", "tinos", "cousine", "carlito", "caladea", "gelasio"];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  // Generation prints PDFs from the HTML templates, which read these files at runtime.
  outputFileTracingIncludes: {
    "/api/extension/generation/artifacts": [
      "./public/resume-templates/**/*",
      "./node_modules/@sparticuz/chromium/bin/**/*",
      ...templateFontPackages.flatMap((fontPackage) => [
        `./node_modules/@fontsource/${fontPackage}/{400,400-italic,700,700-italic}.css`,
        `./node_modules/@fontsource/${fontPackage}/files/*-{400,700}-*.woff2`,
      ]),
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
