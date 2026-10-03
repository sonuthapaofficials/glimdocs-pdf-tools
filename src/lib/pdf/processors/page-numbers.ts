import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type NumberPosition = "bottom-center" | "bottom-right";

// Stamp "Page N" on each page starting from a custom number.
export class PageNumbersProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const start = Math.max(1, Math.floor(Number(input.options?.start ?? 1)));
    const position = (input.options?.position as NumberPosition | undefined) ?? "bottom-center";

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: false });
      const total = doc.getPageCount();
      const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
      const size = 10;

      for (let i = 0; i < total; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        this.report(15 + (i / total) * 70, `Numbering ${i + 1}/${total}…`);
        const page = doc.getPage(i);
        const { width } = page.getSize();
        const label = `${start + i}`;
        const tw = font.widthOfTextAtSize(label, size);
        const x = position === "bottom-right" ? width - tw - 36 : width / 2 - tw / 2;
        page.drawText(label, { x, y: 24, size, font, opacity: 0.85 });
      }

      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
      this.report(100, "Done");
      return this.ok(blob, `${baseName(input.files[0].name)}_numbered.pdf`, {
        pageCount: total,
        start,
      });
    } catch (e) {
      return this.fail(
        "NUMBERING_FAILED",
        "Could not add page numbers.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function addPageNumbers(
  file: File,
  opts: { start?: number; position?: NumberPosition } = {},
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new PageNumbersProcessor().run({ files: [file], options: opts }, onProgress);
}
