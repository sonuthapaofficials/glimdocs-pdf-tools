import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles, toWinAnsi } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export interface TocEntry {
  title: string;
  page: number;
}

export type TocOptions = {
  title?: string;
  entries?: TocEntry[];
};

// Table of contents: inserts numbered TOC pages at the front with REAL
// clickable link annotations (GoTo /Fit destinations) to each target page.
export class TocProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const opts = (input.options ?? {}) as TocOptions;
    const title = toWinAnsi((opts.title ?? "Table of Contents").slice(0, 80)) || "Table of Contents";
    const entries = (opts.entries ?? [])
      .map((e) => ({ title: toWinAnsi(String(e.title ?? "").slice(0, 90)), page: Math.floor(e.page) }))
      .filter((e) => e.title && Number.isFinite(e.page) && e.page >= 1);
    if (entries.length === 0) return this.fail("INVALID_INPUT", 'Add at least one entry ("Title | page").');
    if (entries.length > 500) return this.fail("INVALID_INPUT", "Free plan: up to 500 TOC entries.");

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      let src;
      try {
        src = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (e) {
        return this.fail("LOAD_FAILED", "Could not read this PDF. It may be encrypted or corrupted.", e instanceof Error ? e.message : undefined);
      }
      const srcCount = src.getPageCount();
      for (const e of entries) {
        if (e.page > srcCount) return this.fail("INVALID_INPUT", `"${e.title}" points to page ${e.page}, but the file has ${srcCount} pages.`);
      }

      const font = await src.embedFont(pdfLib.StandardFonts.Helvetica);
      const fontBold = await src.embedFont(pdfLib.StandardFonts.HelveticaBold);
      const W = 595.28;
      const H = 841.89;
      const PER_PAGE = 38;
      const tocCount = Math.max(1, Math.ceil(entries.length / PER_PAGE));
      const out = await pdfLib.PDFDocument.create();
      const tocPages: ReturnType<typeof out.addPage>[] = [];
      for (let i = 0; i < tocCount; i++) tocPages.push(out.addPage([W, H]));

      // Draw entries + collect link geometry.
      const linkJobs: { pageIdx: number; rect: [number, number, number, number]; destIdx: number }[] = [];
      entries.forEach((e, i) => {
        const tp = tocPages[Math.floor(i / PER_PAGE)];
        const row = i % PER_PAGE;
        if (row === 0) {
          tp.drawText(row === 0 && i === 0 ? title : `${title} (cont.)`, { x: 72, y: H - 72, size: 20, font: fontBold });
          tp.drawLine({ start: { x: 72, y: H - 82 }, end: { x: W - 72, y: H - 82 }, thickness: 1, color: pdfLib.rgb(0.6, 0.6, 0.6) });
        }
        const y = H - 110 - row * 17;
        const label = `${i + 1}. ${e.title}`;
        const short = label.length > 62 ? label.slice(0, 61) + "…" : label;
        tp.drawText(short, { x: 72, y, size: 10, font, color: pdfLib.rgb(0.15, 0.2, 0.6) });
        const pg = String(e.page);
        const pgW = font.widthOfTextAtSize(pg, 10);
        tp.drawText(pg, { x: W - 72 - pgW, y, size: 10, font });
        linkJobs.push({ pageIdx: Math.floor(i / PER_PAGE), rect: [72, y - 3, W - 72, y + 11], destIdx: tocCount + (e.page - 1) });
      });
      this.report(50, "Copying pages…");

      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((p) => out.addPage(p));

      // Wire clickable destinations (targets shifted by inserted TOC pages).
      this.report(75, "Linking entries…");
      for (const job of linkJobs) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const tocPage = tocPages[job.pageIdx];
        const destPage = out.getPage(job.destIdx);
        const annot = out.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: job.rect,
          Border: [0, 0, 0],
          Dest: [destPage.ref, pdfLib.PDFName.of("Fit")],
        });
        const ref = out.context.register(annot);
        const existing = tocPage.node.get(pdfLib.PDFName.of("Annots"));
        if (existing instanceof pdfLib.PDFArray) existing.push(ref);
        else tocPage.node.set(pdfLib.PDFName.of("Annots"), out.context.obj([ref]));
      }

      this.report(90, "Saving…");
      const saved = await out.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(
        new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
        `${baseName(input.files[0].name)}_toc.pdf`,
        { pageCount: tocCount + srcCount, tocPages: tocCount, entries: entries.length }
      );
    } catch (e) {
      return this.fail("TOC_FAILED", "Could not build the table of contents.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function addTableOfContents(file: File, options: TocOptions, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new TocProcessor().run({ files: [file], options }, onProgress);
}
