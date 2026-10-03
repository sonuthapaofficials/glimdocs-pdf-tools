import { loadPdfLib } from "./loader";
import { loadPdfJs } from "./pdfjs-loader";

// Skill bundle-preload: warm the heavy engine chunks (pdf-lib, pdf.js)
// on navigation intent (card hover/focus) so the tool page runs instantly
// on click. Both loaders are cached singletons: repeat calls are free,
// and the processor chunks fetch their already-warm deps on demand.
let warmed = false;

export function preloadToolEngines(): void {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  const retry = () => {
    warmed = false;
  };
  void loadPdfLib().catch(retry);
  void loadPdfJs().catch(retry);
}
