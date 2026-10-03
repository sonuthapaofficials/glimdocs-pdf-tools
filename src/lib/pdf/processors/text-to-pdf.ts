import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { toWinAnsi } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type TextToPdfOptions = {
  title?: string;
  fontSize?: number;
};

// Plain text → paginated PDF (A4, Helvetica, word-wrapped).
export class TextToPdfProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const files = input.files;
    if (files.length === 0) return this.fail("INVALID_INPUT", "Please select a .txt file.");
    const f = files[0];
    if (!/\.txt$/i.test(f.name) && f.type !== "text/plain")
      return this.fail("INVALID_INPUT", `"${f.name}" is not a plain-text file.`);
    const opts = (input.options ?? {}) as TextToPdfOptions;
    const title = toWinAnsi((opts.title ?? "").slice(0, 100));
    const size = Math.min(18, Math.max(8, Math.floor(opts.fontSize ?? 11)));

    try {
      this.report(10, "Reading text…");
      const raw = await f.text();
      if (!raw.trim()) return this.fail("INVALID_INPUT", "This file has no text content.");
      if (raw.length > 500_000) return this.fail("INVALID_INPUT", "Free plan: up to ~500k characters per file.");
      this.report(30, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.create();
      const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
      const fontBold = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
      const W = 595.28;
      const H = 841.89;
      const M = 72;
      const maxW = W - M * 2;
      const lineH = size * 1.45;

      const wrap = (line: string): string[] => {
        const words = toWinAnsi(line).split(/\s+/).filter(Boolean);
        if (words.length === 0) return [""];
        const out: string[] = [];
        let cur = "";
        for (const w of words) {
          const trial = cur ? cur + " " + w : w;
          if (font.widthOfTextAtSize(trial, size) <= maxW) cur = trial;
          else {
            if (cur) out.push(cur);
            // Hard-break pathological long tokens.
            let tok = w;
            while (font.widthOfTextAtSize(tok, size) > maxW) {
              let k = tok.length;
              while (k > 1 && font.widthOfTextAtSize(tok.slice(0, k), size) > maxW) k--;
              out.push(tok.slice(0, k));
              tok = tok.slice(k);
            }
            cur = tok;
          }
        }
        if (cur) out.push(cur);
        return out;
      };

      let page = doc.addPage([W, H]);
      let y = H - M;
      let pageNum = 1;
      const fresh = () => { page = doc.addPage([W, H]); y = H - M; pageNum++; };
      if (title) {
        page.drawText(title, { x: M, y, size: size + 6, font: fontBold });
        y -= (size + 6) * 1.8;
      }
      for (const rawLine of raw.replace(/\r\n?/g, "\n").split("\n")) {
        for (const line of wrap(rawLine)) {
          if (y < M + lineH) fresh();
          if (line) page.drawText(line, { x: M, y, size, font });
          y -= lineH;
        }
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
      }
      this.report(90, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(f.name)}.pdf`, { pages: pageNum });
    } catch (e) {
      return this.fail("TEXT_FAILED", "Could not convert this text file.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function textToPdf(file: File, options: TextToPdfOptions = {}, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new TextToPdfProcessor().run({ files: [file], options }, onProgress);
}
