import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

const A4 = { w: 595.28, h: 841.89 };

async function fileToPngBytes(file: File): Promise<Uint8Array> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Cannot decode "${file.name}".`));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/png")
    );
    if (!blob) throw new Error(`Cannot convert "${file.name}".`);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Convert JPG/PNG/WebP images into a single PDF. Fully local.
export class ImagesToPdfProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 100, kind: "image" });
    if (err) return this.fail("INVALID_INPUT", err);

    try {
      this.report(5, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.create();

      for (let i = 0; i < input.files.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const f = input.files[i];
        this.report(10 + (i / input.files.length) * 80, `Adding ${i + 1}/${input.files.length}…`);
        const raw = new Uint8Array(await f.arrayBuffer());
        const lower = f.name.toLowerCase();
        const mime = f.type.toLowerCase();
        let embedded;
        try {
          if (mime === "image/jpeg" || /\.jpe?g$/i.test(lower)) {
            embedded = await doc.embedJpg(raw);
          } else if (mime === "image/png" || /\.png$/i.test(lower)) {
            try {
              embedded = await doc.embedPng(raw);
            } catch {
              embedded = await doc.embedPng(await fileToPngBytes(f));
            }
          } else {
            embedded = await doc.embedPng(await fileToPngBytes(f));
          }
        } catch (e) {
          return this.fail(
            "IMAGE_FAILED",
            `Could not process "${f.name}".`,
            e instanceof Error ? e.message : undefined
          );
        }

        // Fit image onto A4 with 36pt margin, keep aspect ratio.
        const margin = 36;
        const availW = A4.w - margin * 2;
        const availH = A4.h - margin * 2;
        const scale = Math.min(availW / embedded.width, availH / embedded.height, 1);
        const w = embedded.width * scale;
        const h = embedded.height * scale;
        const page = doc.addPage([A4.w, A4.h]);
        page.drawImage(embedded, {
          x: (A4.w - w) / 2,
          y: (A4.h - h) / 2,
          width: w,
          height: h,
        });
      }

      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      const blob = new Blob([new Uint8Array(saved)], { type: "application/pdf" });
      this.report(100, "Done");
      const outName =
        input.files.length === 1
          ? `${baseName(input.files[0].name)}.pdf`
          : `images_${input.files.length}_pages.pdf`;
      return this.ok(blob, outName, { pageCount: input.files.length });
    } catch (e) {
      return this.fail(
        "CONVERT_FAILED",
        "Image to PDF conversion failed.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function imagesToPdf(
  files: File[],
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new ImagesToPdfProcessor().run({ files }, onProgress);
}
