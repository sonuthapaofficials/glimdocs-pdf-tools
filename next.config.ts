import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Rewrite react-icons barrel imports to per-icon modules (smaller client JS).
    optimizePackageImports: ["react-icons"],
  },
  turbopack: {
    // qpdf-wasm is an Emscripten bundle with Node-only branches
    // (require("fs"/"path"/"crypto") behind an isNode runtime guard).
    // Redirect those imports to an empty module for browser targets;
    // those branches never execute in the browser.
    resolveAlias: {
      fs: { browser: "./empty.ts" },
      path: { browser: "./empty.ts" },
      crypto: { browser: "./empty.ts" },
    },
  },
  // Slug cleanup: two registry slugs contained a raw "&" and
  // one a "/" — invalid path segments. Permanent redirects preserve any
  // indexed or bookmarked old URLs.
  async redirects() {
    return [
      { source: "/free-tools/header-&-footer", destination: "/free-tools/header-footer", permanent: true },
      { source: "/free-tools/duplicate-&-organize", destination: "/free-tools/duplicate-organize", permanent: true },
      { source: "/free-tools/pdf-to-pdf/a", destination: "/free-tools/pdf-to-pdfa", permanent: true },
    ];
  },
  async headers() {
    // Baseline CSP: static headers keep every route (incl. static) working.
    // Per https://nextjs.org/docs/app/guides/content-security-policy:
    // React dev (Turbopack) needs 'unsafe-eval' for callstack reconstruction.
    // Gate it to development only — production stays strict (no eval).
    const isDev = process.env.NODE_ENV === "development";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        // Cross-origin isolation: required for SharedArrayBuffer / WASM
        // threads used by the heavier engines (QPDF, pdf.js render workers).
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // credentialless (not require-corp): keeps WASM-thread isolation
          // while not breaking no-cors subresources; wider browser support.
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Ignored over plain HTTP; enforced once TLS terminates in front.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
