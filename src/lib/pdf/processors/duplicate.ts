import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type DuplicateOptions = {
  order?: number[];
};

// Re-sequence pages with an explicit order spec. Repeats are allowed, so
// "1-3, 1, 5" clones pages as well as reorders them.
export class DuplicateProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const order = ((input.options?.order ?? []) as number[]).filter((p) => Number.isFinite(p) && p >= 1);
    if (order.length === 0) return this.fail("INVALID_INPUT", 'Enter a page order, e.g. "3, 1-2, 1" (repeats duplicate the page).');
    if (order.length > 2000) return this.fail("INVALID_INPUT", "Free plan: up to 2,000 pages per output.");

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
      const count = src.getPageCount();
      const bad = order.find((p) => p > count);
      if (bad) return this.fail("INVALID_INPUT", `Page ${bad} is out of range (file has ${count} pages).`);
      this.report(40, "Reordering…");
      const out = await pdfLib.PDFDocument.create();
      const copied = await out.copyPages(src, order.map((p) => p - 1));
      copied.forEach((p) => out.addPage(p));
      this.report(90, "Saving…");
      const saved = await out.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_reordered.pdf`, { pages: order.length });
    } catch (e) {
      return this.fail("REORDER_FAILED", "Could not reorder this PDF.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function duplicateOrganize(file: File, options: DuplicateOptions, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new DuplicateProcessor().run({ files: [file], options }, onProgress);
}
