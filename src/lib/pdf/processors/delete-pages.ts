import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Remove 1-based page numbers from a PDF.
export class DeletePagesProcessor extends BaseLocalProcessor {
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
      return this.fail("INVALID_INPUT", "Enter pages to delete (e.g. 2, 5-7).");

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: false });
      const total = doc.getPageCount();
      const doomed = [...new Set(pages.filter((p) => p >= 1 && p <= total))].sort(
        (a, b) => b - a
      );
      if (doomed.length === 0)
        return this.fail("INVALID_INPUT", `No valid pages in 1–${total}.`);
      if (doomed.length >= total)
        return this.fail("INVALID_INPUT", "Cannot delete every page.");

      for (let i = 0; i < doomed.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        this.report(15 + (i / doomed.length) * 70, `Removing ${i + 1}/${doomed.length}…`);
        doc.removePage(doomed[i] - 1);
      }

      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
      this.report(100, "Done");
      return this.ok(blob, `${baseName(input.files[0].name)}_edited.pdf`, {
        pageCount: doc.getPageCount(),
        removed: doomed.length,
      });
    } catch (e) {
      return this.fail(
        "DELETE_FAILED",
        "Could not delete pages.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function deletePages(
  file: File,
  pages: number[],
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new DeletePagesProcessor().run({ files: [file], options: { pages } }, onProgress);
}
