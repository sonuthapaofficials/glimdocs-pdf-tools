import { BaseLocalProcessor } from "../processor";
import { loadPdfJs } from "../pdfjs-loader";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Pull embedded raster images out of a PDF via the pdf.js operator list:
// every paintImageXObject arg resolves to raw RGBA/gray pixels, which we
// wrap in a canvas and export as PNG. Needs a browser canvas.
export class ExtractImagesProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const files = input.files;
    if (files.length === 0) return this.fail("INVALID_INPUT", "Please select a PDF file.");
    const f = files[0];
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name))
      return this.fail("INVALID_INPUT", `"${f.name}" is not a PDF file.`);
    if (typeof document === "undefined")
      return this.fail("BROWSER_ONLY", "Image extraction needs a browser canvas. Open this tool in your browser.");

    try {
      this.report(5, "Loading PDF engine…");
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pdfjs = await loadPdfJs();
      const task = pdfjs.getDocument({ data: bytes });
      const doc = await task.promise;
      const blobs: Blob[] = [];
      const names: string[] = [];
      try {
        const OPS = pdfjs.OPS;
        for (let p = 1; p <= doc.numPages; p++) {
          if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
          this.report(5 + Math.round((p / doc.numPages) * 80), `Scanning page ${p}/${doc.numPages}…`);
          const page = await doc.getPage(p);
          const opList = await page.getOperatorList();
          const seen = new Set<string>();
          for (let i = 0; i < opList.fnArray.length; i++) {
            if (opList.fnArray[i] !== OPS.paintImageXObject) continue;
            const objName = opList.argsArray[i]?.[0] as string | undefined;
            if (!objName || seen.has(objName)) continue;
            seen.add(objName);
            const img = await new Promise<{ width: number; height: number; data: Uint8Array | Uint8ClampedArray } | null>((resolve) => {
              try {
                page.objs.get(objName, (data: unknown) => resolve(data as { width: number; height: number; data: Uint8Array }));
              } catch {
                resolve(null);
              }
            });
            if (!img || !img.width || !img.height) continue;
            const px = img.width * img.height;
            let rgba: Uint8ClampedArray<ArrayBuffer>;
            if (img.data.length === px * 4) {
              rgba = new Uint8ClampedArray(new ArrayBuffer(img.data.length));
              rgba.set(img.data);
            } else if (img.data.length === px) {
              rgba = new Uint8ClampedArray(new ArrayBuffer(px * 4));
              for (let k = 0; k < px; k++) {
                rgba[k * 4] = rgba[k * 4 + 1] = rgba[k * 4 + 2] = img.data[k];
                rgba[k * 4 + 3] = 255;
              }
            } else continue; // masks / exotic colorspaces — skip
            if (img.width < 16 || img.height < 16) continue; // skip tiny fragments
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) continue;
            ctx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
            const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
            if (blob && blob.size > 0) {
              blobs.push(blob);
              names.push(`${baseName(f.name)}_p${p}_img${names.length + 1}.png`);
            }
          }
        }
      } finally {
        await task.destroy();
      }
      if (blobs.length === 0)
        return this.fail("NO_IMAGES", "No extractable raster images found (vector-only PDF, or images are masks).");
      this.report(100, "Done");
      return this.ok(blobs.length === 1 ? blobs[0] : blobs, names.length === 1 ? names[0] : names, { images: blobs.length });
    } catch (e) {
      return this.fail("EXTRACT_FAILED", "Could not extract images from this PDF.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function extractImages(file: File, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new ExtractImagesProcessor().run({ files: [file] }, onProgress);
}
