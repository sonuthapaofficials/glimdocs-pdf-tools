// Lazy loader for pdf.js (rendering + text extraction).
// The ~1MB pdfjs-dist chunk is fetched only when a Tier 2 tool runs,
// never on page load. Worker stays local under /workers/ (no CDN).

type PdfJsModule = typeof import("pdfjs-dist");

let cached: PdfJsModule | null = null;
let inflight: Promise<PdfJsModule> | null = null;
let workerReady = false;

export async function loadPdfJs(): Promise<PdfJsModule> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = import("pdfjs-dist").then((mod) => {
    if (!workerReady && typeof window !== "undefined") {
      mod.GlobalWorkerOptions.workerSrc = "/workers/pdf.worker.min.mjs";
      workerReady = true;
    }
    cached = mod;
    inflight = null;
    return mod;
  });
  return inflight;
}

export function isPdfJsLoaded(): boolean {
  return cached !== null;
}
