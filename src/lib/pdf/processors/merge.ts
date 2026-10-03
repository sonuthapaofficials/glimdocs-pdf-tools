import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

function stripExt(name: string): string {
  return baseName(name);
}

// Combine 2+ PDFs in order. Pure pdf-lib, fully local.
export class MergeProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 2, max: 100, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");

    try {
      this.report(5, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const out = await pdfLib.PDFDocument.create();
      let totalPages = 0;

      for (let i = 0; i < input.files.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const f = input.files[i];
        this.report(10 + (i / input.files.length) * 80, `Merging ${i + 1}/${input.files.length}…`);
        const bytes = await f.arrayBuffer();
        let src;
        try {
          src = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: false });
        } catch (e) {
          return this.fail(
            "LOAD_FAILED",
            `Could not read "${f.name}". It may be encrypted or corrupted.`,
            e instanceof Error ? e.message : undefined
          );
        }
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
        totalPages += src.getPageCount();
      }

      this.report(95, "Saving…");
      const saved = await out.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
      const first = stripExt(input.files[0].name);
      this.report(100, "Done");
      return this.ok(blob, `${first}_merged.pdf`, {
        pageCount: totalPages,
        fileCount: input.files.length,
      });
    } catch (e) {
      return this.fail(
        "MERGE_FAILED",
        "Merging failed.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function mergePdfs(
  files: File[],
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new MergeProcessor().run({ files }, onProgress);
}
