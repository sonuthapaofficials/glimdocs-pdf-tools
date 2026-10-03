import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { loadPdfJs } from "../pdfjs-loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type RasterizeOptions = {
  scale?: 1 | 2 | 3;
};

// Bake every page to a bitmap (text unselectable, vectors frozen) and
// rebuild the PDF from those images. Needs a browser canvas.
export class RasterizeProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    if (typeof document === "undefined")
      return this.fail("BROWSER_ONLY", "Rasterization needs a browser canvas. Open this tool in your browser.");
    const scale = (input.options?.scale as 1 | 2 | 3) ?? 2;

    try {
      this.report(5, "Loading engines…");
      const pdfLib = await loadPdfLib();
      const bytes = new Uint8Array(await input.files[0].arrayBuffer());
      const pdfjs = await loadPdfJs();
      const task = pdfjs.getDocument({ data: bytes });
      const doc = await task.promise;
      const out = await pdfLib.PDFDocument.create();
      try {
        for (let p = 1; p <= doc.numPages; p++) {
          if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
          this.report(5 + Math.round((p / doc.numPages) * 80), `Baking page ${p}/${doc.numPages}…`);
          const page = await doc.getPage(p);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, viewport, background: "#ffffff" }).promise;
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
          if (!blob) return this.fail("RASTER_FAILED", `Could not bake page ${p}.`);
          const embedded = await out.embedPng(new Uint8Array(await blob.arrayBuffer()));
          // 1 viewport unit ≈ 1pt at scale 1 → divide back to points.
          const w = canvas.width / scale;
          const h = canvas.height / scale;
          const newPage = out.addPage([w, h]);
          newPage.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
        }
      } finally {
        await task.destroy();
      }
      this.report(95, "Saving…");
      const saved = await out.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_raster.pdf`, { pages: out.getPageCount() });
    } catch (e) {
      return this.fail("RASTER_FAILED", "Could not rasterize this PDF.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function rasterizePdf(file: File, options: RasterizeOptions = {}, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new RasterizeProcessor().run({ files: [file], options }, onProgress);
}
