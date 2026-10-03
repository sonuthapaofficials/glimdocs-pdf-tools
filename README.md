# GlimDocs PDF Tools — Modified Version of BentoPDF, PyMuPDF & pdfcraft

This project is a modified version of the following open-source projects:

**Original projects:**

1. BentoPDF — The Privacy First PDF Toolkit
   https://github.com/alam00000/bentopdf

2. PyMuPDF — high performance Python library for PDF data extraction,
   analysis, conversion & manipulation
   https://github.com/pymupdf/PyMuPDF

3. pdfcraft — free, privacy-focused PDF toolkit that runs entirely in
   your browser
   https://github.com/PDFCraftTool/pdfcraft

**Original copyright:**

- BentoPDF: Copyright © alam00000 and the BentoPDF contributors
- PyMuPDF: Copyright © Artifex Software, Inc. and the PyMuPDF contributors
- pdfcraft: Copyright © PDFCraftTool and the pdfcraft contributors

**Original license:**

GNU Affero General Public License v3.0 (AGPL-3.0) — for all three projects.

**Modifications:**

Copyright © 2026 GlimDocs.

This version has been modified by GlimDocs.
The modifications include:

- Re-implemented the PDF processing workflows as TypeScript/WebAssembly
  engines (`pdf-lib`, `pdf.js`, `qpdf-wasm`) that run 100% client-side in
  the browser — your files never leave your device, zero uploads.
- Rebuilt the application as a Next.js App Router project with a 50-tool
  catalog, one route per tool (`/free-tools/[tool]`), SEO metadata,
  sitemap/robots and JSON-LD structured data.
- Added and expanded engines: spatial table detection (PDF → Excel/CSV),
  DOCX/XLSX/Text/Markdown/CSV/SVG-to-PDF importers, bookmark outline
  editor, Bates numbering, header & footer, stamps, table of contents,
  page-size fixing, repair, rasterize, deskew, sanitize/flatten, metadata
  tools, form filling, AES protect/unlock.
- Replaced the original branding with GlimDocs branding; the marketing
  site is maintained separately and is not part of this repository.

This software is licensed under the GNU Affero General Public
License version 3, as required by the original projects.

See LICENSE for the complete license text. See NOTICE for the short
attribution notice and THIRD-PARTY-NOTICES for every third-party
component and its license.

---

## What is this?

50+ free PDF tools — merge, split, compress, convert, sign, deskew, repair
and edit PDFs entirely in your browser. No signup, no watermark, no uploads.

```
README.md
LICENSE                  # GNU AGPL v3.0 full text
NOTICE                   # short attribution notice
THIRD-PARTY-NOTICES      # every third-party component + license
src/
  app/
    free-tools/          # tool catalog page + metadata
    free-tools/[tool]/   # per-tool runner page + metadata
    layout.tsx           # standalone root layout
    page.tsx             # redirects / → /free-tools
    globals.css          # Tailwind theme + self-hosted icon font
    sitemap.ts robots.ts # SEO routes
  lib/
    pdf/                 # tool registry, types, loaders, processors/*
    brand.ts             # brand constants (self-contained)
public/
  fonts/                 # self-hosted Material Symbols subset (no CDN)
  glogo.svg glogo.ico    # brand assets
scripts/                 # stage pdf.js worker + qpdf.wasm (postinstall)
empty.ts                 # Turbopack browser stub for Node built-ins
next.config.ts           # COOP/COEP isolation + CSP headers for WASM
...
```

## Getting started

Requirements: Node.js 18+.

```bash
npm install   # postinstall stages public/workers + public/qpdf.wasm locally
npm run dev   # http://localhost:3000/free-tools
npm run build # production build
npm start     # serve the production build
```

All processing stays on-device: the pdf.js worker and `qpdf.wasm` are
served from `public/` (staged at install time) — no CDN, no uploads.

## License & AGPL obligations

This repository is **AGPL-3.0-only**. If you run a modified version of
this software on a network server, AGPL Section 13 requires you to offer
all users interacting with it remotely an opportunity to receive the
Corresponding Source of your version at no charge. See LICENSE.

## Maintenance note

This repo is exported from the `agpl/` directory of the private GlimDocs
monorepo via `git subtree split -P agpl`:

```bash
git subtree split -P agpl -b agpl-only
git push <public-remote> agpl-only:main
```
