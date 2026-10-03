import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Trim a uniform margin (in points, 72 = 1 inch) off every side
// by shrinking each page's CropBox. Fully local via pdf-lib.
export class CropProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const margin = Number(input.options?.margin ?? 36);
    if (!Number.isFinite(margin) || margin < 0 || margin > 200)
      return this.fail("INVALID_INPUT", "Margin must be between 0 and 200 pt.");
    const pages = (input.options?.pages as number[] | undefined) ?? [];

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: false });
      const total = doc.getPageCount();
      const targets =
        pages.length === 0
          ? doc.getPageIndices()
          : pages.filter((p) => p >= 1 && p <= total).map((p) => p - 1);
      if (targets.length === 0)
        return this.fail("INVALID_INPUT", `No valid pages in 1–${total}.`);

      for (let i = 0; i < targets.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        this.report(15 + (i / targets.length) * 70, `Cropping ${i + 1}/${targets.length}…`);
        const page = doc.getPage(targets[i]);
        const { width, height } = page.getSize();
        if (margin * 2 >= Math.min(width, height))
          return this.fail(
            "INVALID_INPUT",
            `Margin ${margin}pt is larger than page ${targets[i] + 1}.`
          );
        page.setCropBox(margin, margin, width - margin * 2, height - margin * 2);
      }

      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
      this.report(100, "Done");
      return this.ok(blob, `${baseName(input.files[0].name)}_cropped.pdf`, {
        pageCount: total,
        cropped: targets.length,
        margin,
      });
    } catch (e) {
      return this.fail(
        "CROP_FAILED",
        "Could not crop this PDF.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function cropPdf(
  file: File,
  opts: { margin?: number; pages?: number[] } = {},
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new CropProcessor().run({ files: [file], options: opts }, onProgress);
}
