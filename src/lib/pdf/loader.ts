// Lazy loader for pdf-lib so the heavy library is only fetched
// when a user actually runs a tool. Clean-room implementation.

type PdfLibModule = typeof import("pdf-lib");

let cached: PdfLibModule | null = null;
let inflight: Promise<PdfLibModule> | null = null;

export async function loadPdfLib(): Promise<PdfLibModule> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = import("pdf-lib").then((mod) => {
    cached = mod;
    inflight = null;
    return mod;
  });
  return inflight;
}

export function isPdfLibLoaded(): boolean {
  return cached !== null;
}
