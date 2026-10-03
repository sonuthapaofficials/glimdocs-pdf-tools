import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type SvgToPdfOptions = {
  scale?: 1 | 2 | 3;
};

// SVG → PDF by rasterizing in the browser (canvas) and embedding the
// result. Vector paths are baked to pixels — true vector conversion
// ships in a later tier.
export class SvgToPdfProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const files = input.files;
    if (files.length === 0) return this.fail("INVALID_INPUT", "Please select an SVG file.");
    const f = files[0];
    if (!/\.svg$/i.test(f.name) && f.type !== "image/svg+xml")
      return this.fail("INVALID_INPUT", `"${f.name}" is not an SVG file.`);
    if (typeof document === "undefined")
      return this.fail("BROWSER_ONLY", "SVG rasterization needs a browser canvas. Open this tool in your browser.");
    const scale = (input.options?.scale as 1 | 2 | 3) ?? 2;

    try {
      this.report(10, "Loading SVG…");
      const text = await f.text();
      const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Could not render this SVG (external references are blocked)."));
        el.src = url;
      }).finally(() => URL.revokeObjectURL(url));
      const w = img.naturalWidth || 800;
      const h = img.naturalHeight || 600;

      this.report(40, "Rasterizing…");
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(4096, w * scale);
      canvas.height = Math.min(4096, Math.round((h * canvas.width) / w));
      const ctx = canvas.getContext("2d");
      if (!ctx) return this.fail("BROWSER_ONLY", "Canvas 2D is unavailable in this browser.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!png) return this.fail("SVG_FAILED", "Could not rasterize this SVG.");

      this.report(70, "Building PDF…");
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.create();
      // 96 CSS px = 72 pt.
      const page = doc.addPage([canvas.width * (72 / 96), canvas.height * (72 / 96)]);
      const embedded = await doc.embedPng(new Uint8Array(await png.arrayBuffer()));
      page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(f.name)}.pdf`, { width: canvas.width, height: canvas.height });
    } catch (e) {
      return this.fail("SVG_FAILED", "Could not convert this SVG.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function svgToPdf(file: File, options: SvgToPdfOptions = {}, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new SvgToPdfProcessor().run({ files: [file], options }, onProgress);
}
