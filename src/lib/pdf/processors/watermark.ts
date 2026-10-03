import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Diagonal text watermark on every page (or selected pages).
export class WatermarkProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const text = String(input.options?.text ?? "").trim();
    if (!text) return this.fail("INVALID_INPUT", "Enter watermark text.");
    if (text.length > 80) return this.fail("INVALID_INPUT", "Keep watermark under 80 characters.");
    const opacity = Math.min(0.5, Math.max(0.05, Number(input.options?.opacity ?? 0.15)));
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

      const font = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
      for (let i = 0; i < targets.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        this.report(15 + (i / targets.length) * 70, `Marking ${i + 1}/${targets.length}…`);
        const page = doc.getPage(targets[i]);
        const { width, height } = page.getSize();
        const size = Math.min(width, height) / 8;
        const tw = font.widthOfTextAtSize(text, size);
        page.drawText(text, {
          x: width / 2 - (tw * Math.SQRT1_2) / 2,
          y: height / 2,
          size,
          font,
          opacity,
          rotate: pdfLib.degrees(45),
        });
      }

      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
      this.report(100, "Done");
      return this.ok(blob, `${baseName(input.files[0].name)}_watermarked.pdf`, {
        pageCount: total,
        marked: targets.length,
      });
    } catch (e) {
      return this.fail(
        "WATERMARK_FAILED",
        "Could not apply watermark.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function addWatermark(
  file: File,
  opts: { text: string; opacity?: number; pages?: number[] } = { text: "" },
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new WatermarkProcessor().run({ files: [file], options: opts }, onProgress);
}
