import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Rotate pages by 90/180/270 degrees. Empty `pages` = all pages (1-based).
export class RotateProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const angle = Number(input.options?.angle ?? 90);
    if (![90, 180, 270].includes(angle))
      return this.fail("INVALID_INPUT", "Angle must be 90, 180 or 270.");
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
        this.report(15 + (i / targets.length) * 70, `Rotating ${i + 1}/${targets.length}…`);
        const page = doc.getPage(targets[i]);
        const current = page.getRotation().angle;
        page.setRotation(pdfLib.degrees((current + angle) % 360));
      }

      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
      this.report(100, "Done");
      return this.ok(blob, `${baseName(input.files[0].name)}_rotated-${angle}.pdf`, {
        pageCount: total,
        rotated: targets.length,
      });
    } catch (e) {
      return this.fail(
        "ROTATE_FAILED",
        "Rotation failed.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function rotatePdf(
  file: File,
  angle: number,
  pages: number[] = [],
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new RotateProcessor().run({ files: [file], options: { angle, pages } }, onProgress);
}
