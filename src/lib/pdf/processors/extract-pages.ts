import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Keep only the given 1-based pages, in the order supplied.
export class ExtractPagesProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const pages = (input.options?.pages as number[] | undefined) ?? [];
    if (pages.length === 0)
      return this.fail("INVALID_INPUT", "Enter pages to keep (e.g. 1-3, 8).");

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      const src = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: false });
      const total = src.getPageCount();
      const keep = pages.filter((p) => p >= 1 && p <= total);
      if (keep.length === 0)
        return this.fail("INVALID_INPUT", `No valid pages in 1–${total}.`);

      this.report(30, "Copying pages…");
      const doc = await pdfLib.PDFDocument.create();
      const copied = await doc.copyPages(src, keep.map((p) => p - 1));
      copied.forEach((p) => doc.addPage(p));

      this.report(90, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
      this.report(100, "Done");
      return this.ok(blob, `${baseName(input.files[0].name)}_extracted.pdf`, {
        pageCount: keep.length,
        sourcePages: total,
      });
    } catch (e) {
      return this.fail(
        "EXTRACT_FAILED",
        "Could not extract pages.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function extractPages(
  file: File,
  pages: number[],
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new ExtractPagesProcessor().run({ files: [file], options: { pages } }, onProgress);
}
