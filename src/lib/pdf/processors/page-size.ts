import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type PageTarget = "A4" | "Letter" | "Legal" | "A3";
export type PageOrientation = "auto" | "portrait" | "landscape";

const SIZES: Record<PageTarget, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Legal: [612, 1008],
  A3: [841.89, 1190.55],
};

export type PageSizeOptions = {
  target?: PageTarget;
  orientation?: PageOrientation;
};

// Standardize every page to a target size: each source page is embedded
// and drawn contained + centered (aspect preserved, never cropped).
export class PageSizeProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const opts = (input.options ?? {}) as PageSizeOptions;
    const target = SIZES[opts.target ?? "A4"] ? (opts.target ?? "A4") : "A4";
    const orientation = opts.orientation ?? "auto";
    const [tw, th] = SIZES[target];

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      let src;
      try {
        src = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (e) {
        return this.fail("LOAD_FAILED", "Could not read this PDF. It may be encrypted or corrupted.", e instanceof Error ? e.message : undefined);
      }
      const out = await pdfLib.PDFDocument.create();
      const pages = src.getPages();
      for (let i = 0; i < pages.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const sp = pages[i];
        const { width: sw, height: sh } = sp.getSize();
        let dw = tw;
        let dh = th;
        const wantLandscape = orientation === "landscape" || (orientation === "auto" && sw > sh);
        const wantPortrait = orientation === "portrait" || (orientation === "auto" && sw <= sh);
        if (wantLandscape && dw < dh) [dw, dh] = [dh, dw];
        if (wantPortrait && dw > dh) [dw, dh] = [dh, dw];
        const embedded = await out.embedPage(sp);
        const page = out.addPage([dw, dh]);
        const s = Math.min(dw / sw, dh / sh);
        const w = sw * s;
        const h = sh * s;
        page.drawPage(embedded, { x: (dw - w) / 2, y: (dh - h) / 2, width: w, height: h });
        this.report(10 + Math.round(((i + 1) / pages.length) * 80), `Resizing ${i + 1}/${pages.length}…`);
      }
      this.report(95, "Saving…");
      const saved = await out.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_${target.toLowerCase()}.pdf`, { pageCount: pages.length, target });
    } catch (e) {
      return this.fail("PAGESIZE_FAILED", "Could not standardize page sizes.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function fixPageSize(file: File, options: PageSizeOptions, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new PageSizeProcessor().run({ files: [file], options }, onProgress);
}
