import { BaseLocalProcessor } from "../processor";
import { loadPdfJs } from "../pdfjs-loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";
import type { PDFPageProxy } from "pdfjs-dist";

export type ImageFormat = "png" | "jpg" | "webp";

const MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const EXT: Record<ImageFormat, string> = {
  png: "png",
  jpg: "jpg",
  webp: "webp",
};

function renderPageToBlob(
  page: PDFPageProxy,
  scale: number,
  format: ImageFormat,
  quality: number
): Promise<Blob> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  if (!canvas.getContext("2d")) throw new Error("Canvas is not available in this browser.");
  return page
    .render({ canvas, viewport, background: "#ffffff" })
    .promise.then(
      () =>
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => {
              // Release pixel memory immediately (mobile safety).
              canvas.width = 0;
              canvas.height = 0;
              if (b) resolve(b);
              else reject(new Error("Could not encode image."));
            },
            MIME[format],
            format === "png" ? undefined : quality
          );
        })
    );
}

// Render PDF pages to images, one page at a time (bounded memory).
// pdf.js is dynamically imported, so this chunk loads only on demand.
export class PdfToImageProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const format = (input.options?.format as ImageFormat | undefined) ?? "png";
    const scale = Number(input.options?.scale ?? 2);
    const quality = Number(input.options?.quality ?? 0.92);
    const wanted = (input.options?.pages as number[] | undefined) ?? [];
    if (!["png", "jpg", "webp"].includes(format))
      return this.fail("INVALID_INPUT", "Format must be png, jpg or webp.");

    try {
      this.report(5, "Loading render engine…");
      const pdfjs = await loadPdfJs();
      const bytes = new Uint8Array(await input.files[0].arrayBuffer());
      this.report(10, "Opening PDF…");
      const loadingTask = pdfjs.getDocument({ data: bytes });
      const doc = await loadingTask.promise;
      const total = doc.numPages;
      const targets =
        wanted.length === 0
          ? Array.from({ length: total }, (_, i) => i + 1)
          : wanted.filter((p) => p >= 1 && p <= total);
      if (targets.length === 0) {
        await loadingTask.destroy();
        return this.fail("INVALID_INPUT", `No valid pages in 1–${total}.`);
      }

      const blobs: Blob[] = [];
      for (let i = 0; i < targets.length; i++) {
        if (this.isCancelled()) {
          await loadingTask.destroy();
          return this.fail("CANCELLED", "Cancelled.");
        }
        this.report(10 + (i / targets.length) * 85, `Rendering page ${targets[i]}…`);
        const page = await doc.getPage(targets[i]);
        blobs.push(await renderPageToBlob(page, scale, format, quality));
        page.cleanup();
      }
      await loadingTask.destroy();

      this.report(100, "Done");
      const stem = baseName(input.files[0].name);
      if (blobs.length === 1)
        return this.ok(blobs[0], `${stem}_p${targets[0]}.${EXT[format]}`, {
          format,
          pageCount: 1,
        });
      const names = targets.map((p) => `${stem}_p${p}.${EXT[format]}`);
      return this.ok(blobs, names, { format, pageCount: blobs.length });
    } catch (e) {
      return this.fail(
        "RENDER_FAILED",
        "Could not render this PDF.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function pdfToImages(
  file: File,
  opts: { format?: ImageFormat; scale?: number; quality?: number; pages?: number[] } = {},
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new PdfToImageProcessor().run({ files: [file], options: opts }, onProgress);
}
