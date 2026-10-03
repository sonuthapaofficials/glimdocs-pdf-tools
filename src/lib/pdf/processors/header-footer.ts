import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles, toWinAnsi } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type HeaderFooterOptions = {
  header?: string;
  footer?: string;
};

// Running header + footer on every page. Use {p} in the footer for the
// page number and {n} for the total page count.
export class HeaderFooterProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const opts = (input.options ?? {}) as HeaderFooterOptions;
    const header = toWinAnsi((opts.header ?? "").slice(0, 120));
    const footerRaw = toWinAnsi((opts.footer ?? "").slice(0, 120));
    if (!header && !footerRaw) return this.fail("INVALID_INPUT", "Enter a header, a footer, or both.");

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
      const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
      const size = 9;
      const gray = pdfLib.rgb(0.35, 0.35, 0.35);
      const pages = doc.getPages();
      for (let i = 0; i < pages.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const page = pages[i];
        const { width, height } = page.getSize();
        if (header) {
          const tw = font.widthOfTextAtSize(header, size);
          page.drawText(header, { x: (width - tw) / 2, y: height - 30, size, font, color: gray });
        }
        if (footerRaw) {
          const footer = footerRaw.replace(/\{p\}/g, String(i + 1)).replace(/\{n\}/g, String(pages.length));
          const tw = font.widthOfTextAtSize(footer, size);
          page.drawText(footer, { x: (width - tw) / 2, y: 30, size, font, color: gray });
        }
        this.report(10 + Math.round(((i + 1) / pages.length) * 80), `Page ${i + 1}/${pages.length}…`);
      }
      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_header-footer.pdf`, { pageCount: pages.length });
    } catch (e) {
      return this.fail("HEADER_FOOTER_FAILED", "Could not add the header/footer.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function addHeaderFooter(file: File, options: HeaderFooterOptions, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new HeaderFooterProcessor().run({ files: [file], options }, onProgress);
}
