import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type {
  PageRange,
  ProcessInput,
  ProcessOutput,
  ProgressCallback,
} from "../types";

// Split one PDF into several files by 1-based page ranges.
export class SplitProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const ranges = (input.options?.ranges as PageRange[] | undefined) ?? [];
    if (ranges.length === 0)
      return this.fail("INVALID_INPUT", "Add at least one page range (e.g. 1-3).");

    try {
      this.report(5, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      let src;
      try {
        src = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: false });
      } catch (e) {
        return this.fail(
          "LOAD_FAILED",
          "Could not read this PDF. It may be encrypted or corrupted.",
          e instanceof Error ? e.message : undefined
        );
      }
      const total = src.getPageCount();
      for (const r of ranges) {
        if (r.start < 1 || r.end < r.start || r.end > total)
          return this.fail(
            "INVALID_RANGE",
            `Range ${r.start}-${r.end} is outside 1–${total}.`
          );
      }

      const blobs: Blob[] = [];
      const names: string[] = [];
      const stem = baseName(input.files[0].name);
      for (let i = 0; i < ranges.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const r = ranges[i];
        this.report(10 + (i / ranges.length) * 80, `Extracting ${r.start}–${r.end}…`);
        const doc = await pdfLib.PDFDocument.create();
        const idx: number[] = [];
        for (let p = r.start; p <= r.end; p++) idx.push(p - 1);
        const pages = await doc.copyPages(src, idx);
        pages.forEach((p) => doc.addPage(p));
        const saved = await doc.save({ useObjectStreams: true });
        blobs.push(new Blob([new Uint8Array(saved)], { type: "application/pdf" }));
        names.push(
          ranges.length === 1
            ? `${stem}_pages_${r.start}-${r.end}.pdf`
            : `${stem}_part${i + 1}_${r.start}-${r.end}.pdf`
        );
      }
      this.report(100, "Done");
      if (blobs.length === 1) return this.ok(blobs[0], names[0], { sourcePages: total });
      return this.ok(blobs, names, { sourcePages: total, parts: blobs.length });
    } catch (e) {
      return this.fail(
        "SPLIT_FAILED",
        "Splitting failed.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function splitPdf(
  file: File,
  ranges: PageRange[],
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new SplitProcessor().run({ files: [file], options: { ranges } }, onProgress);
}
