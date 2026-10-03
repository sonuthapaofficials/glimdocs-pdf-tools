import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles, toWinAnsi } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type BatesPosition = "bottom-center" | "bottom-right" | "top-center" | "top-right";

export type BatesOptions = {
  prefix?: string;
  start?: number;
  digits?: number;
  position?: BatesPosition;
};

// Bates stamping: sequential litigation IDs (e.g. ACME-000123) on every page.
export class BatesProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const opts = (input.options ?? {}) as BatesOptions;
    const prefix = toWinAnsi((opts.prefix ?? "GLIM-").slice(0, 24));
    const start = Math.max(1, Math.floor(opts.start ?? 1));
    const digits = Math.min(10, Math.max(1, Math.floor(opts.digits ?? 6)));
    const position = opts.position ?? "bottom-right";

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      let doc;
      try {
        doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (e) {
        return this.fail("LOAD_FAILED", "Could not read this PDF. It may be encrypted or corrupted.", e instanceof Error ? e.message : undefined);
      }
      const font = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
      const size = 10;
      const margin = 36;
      const pages = doc.getPages();
      for (let i = 0; i < pages.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const page = pages[i];
        const { width, height } = page.getSize();
        const label = `${prefix}${String(start + i).padStart(digits, "0")}`;
        const tw = font.widthOfTextAtSize(label, size);
        let x = width - margin - tw;
        let y = margin;
        if (position === "bottom-center") x = (width - tw) / 2;
        if (position === "top-center") { x = (width - tw) / 2; y = height - margin - size; }
        if (position === "top-right") y = height - margin - size;
        page.drawText(label, { x, y, size, font, color: pdfLib.rgb(0, 0, 0) });
        this.report(10 + Math.round(((i + 1) / pages.length) * 80), `Stamping ${i + 1}/${pages.length}…`);
      }
      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_bates.pdf`, { pageCount: pages.length, start });
    } catch (e) {
      return this.fail("BATES_FAILED", "Could not apply Bates numbering.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function addBatesNumbering(file: File, options: BatesOptions, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new BatesProcessor().run({ files: [file], options }, onProgress);
}
