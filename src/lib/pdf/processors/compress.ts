import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Compress v1: rewrite the file through pdf-lib with object streams and
// strip identifying document metadata. This removes incremental-update
// history and metadata weight. It does NOT downsample images — that
// needs the heavier Tier 3 engines (kept out of v1 on purpose).
export class CompressProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);

    try {
      const originalSize = input.files[0].size;
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      let doc;
      try {
        doc = await pdfLib.PDFDocument.load(bytes, {
          ignoreEncryption: false,
          updateMetadata: false,
        });
      } catch (e) {
        return this.fail(
          "LOAD_FAILED",
          "Could not read this PDF. It may be encrypted or corrupted.",
          e instanceof Error ? e.message : undefined
        );
      }

      this.report(40, "Stripping metadata…");
      doc.setTitle("");
      doc.setAuthor("");
      doc.setSubject("");
      doc.setKeywords([]);
      doc.setCreator("");
      doc.setProducer("");

      if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
      this.report(70, "Rewriting file…");
      const saved = await doc.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
      const newSize = blob.size;

      this.report(100, "Done");
      const savedBytes = Math.max(0, originalSize - newSize);
      return this.ok(blob, `${baseName(input.files[0].name)}_compressed.pdf`, {
        originalSize,
        newSize,
        savedBytes,
        pageCount: doc.getPageCount(),
        alreadyOptimal: newSize >= originalSize,
      });
    } catch (e) {
      return this.fail(
        "COMPRESS_FAILED",
        "Could not compress this PDF.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function compressPdf(
  file: File,
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new CompressProcessor().run({ files: [file] }, onProgress);
}
