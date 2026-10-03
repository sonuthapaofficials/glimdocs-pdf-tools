import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles, toWinAnsi } from "../validation";
import { baseName } from "../download";
import type { PDFPage } from "pdf-lib";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type SignPosition = "bottom-left" | "bottom-center" | "bottom-right";

export type SignOptions = {
  imageBytes?: Uint8Array;
  imageMime?: string;
  text?: string;
  position?: SignPosition;
  pages?: number[];
};

// Visual e-signature: stamp an uploaded signature image (PNG/JPG) or a
// typed name onto chosen pages. This is a visible mark, not a
// cryptographic (PKCS#7) signature — that ships in a later tier.
export class SignProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const opts = (input.options ?? {}) as SignOptions;
    const text = toWinAnsi((opts.text ?? "").slice(0, 60));
    if (!opts.imageBytes && !text) return this.fail("INVALID_INPUT", "Upload a signature image or type your name.");
    const position = opts.position ?? "bottom-right";

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      let doc;
      try {
        doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (e) {
        return this.fail("LOAD_FAILED", "Could not read this PDF. It may be encrypted or corrupted.", e instanceof Error ? e.message : undefined);
      }
      const pageCount = doc.getPageCount();
      let targets = (opts.pages ?? []).filter((p) => Number.isFinite(p) && p >= 1 && p <= pageCount);
      if (targets.length === 0) targets = [pageCount]; // default: last page

      let draw: ((page: PDFPage, x: number, y: number, w: number, h: number) => void) | null = null;
      let sigW = 160;
      let sigH = 60;
      if (opts.imageBytes) {
        const mime = (opts.imageMime ?? "").toLowerCase();
        const img = mime.includes("jpeg") || mime.includes("jpg")
          ? await doc.embedJpg(opts.imageBytes)
          : await doc.embedPng(opts.imageBytes);
        const maxW = 220;
        const scale = Math.min(1, maxW / img.width);
        sigW = img.width * scale;
        sigH = img.height * scale;
        draw = (page, x, y, w, h) => { page.drawImage(img, { x, y, width: w, height: h }); };
      } else {
        const font = await doc.embedFont(pdfLib.StandardFonts.HelveticaOblique);
        const size = 26;
        sigW = Math.min(260, font.widthOfTextAtSize(text, size) + 24);
        sigH = size + 20;
        draw = (page, x, y) => {
          page.drawRectangle({ x: x - 8, y: y - 8, width: sigW, height: sigH, borderColor: pdfLib.rgb(0.1, 0.2, 0.5), borderWidth: 1.5 });
          page.drawText(text, { x, y, size, font, color: pdfLib.rgb(0.1, 0.2, 0.5) });
        };
      }

      for (let i = 0; i < targets.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const page = doc.getPage(targets[i] - 1);
        const { width } = page.getSize();
        const m = 48;
        let x = width - m - sigW;
        if (position === "bottom-center") x = (width - sigW) / 2;
        if (position === "bottom-left") x = m;
        draw(page, x, 64, sigW, sigH);
        this.report(10 + Math.round(((i + 1) / targets.length) * 80), `Signing ${i + 1}/${targets.length}…`);
      }
      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_signed.pdf`, { pages: targets });
    } catch (e) {
      return this.fail("SIGN_FAILED", "Could not apply the signature.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function signPdfVisual(file: File, options: SignOptions, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new SignProcessor().run({ files: [file], options }, onProgress);
}
