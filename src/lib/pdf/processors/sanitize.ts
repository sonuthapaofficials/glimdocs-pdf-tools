import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type SanitizeOptions = {
  metadata?: boolean;
  javascript?: boolean;
  annotations?: boolean;
  forms?: boolean;
};

// Privacy scrub: strip document metadata/XMP, embedded JavaScript +
// launch actions, annotations, and interactive forms — per toggle.
export class SanitizeProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const o = (input.options ?? {}) as SanitizeOptions;
    const doMeta = o.metadata !== false;
    const doJs = o.javascript !== false;
    const doAnnots = o.annotations === true;
    const doForms = o.forms === true;
    if (!doMeta && !doJs && !doAnnots && !doForms)
      return this.fail("INVALID_INPUT", "Enable at least one scrub target.");

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const { PDFName } = pdfLib;
      const bytes = await input.files[0].arrayBuffer();
      let doc;
      try {
        doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (e) {
        return this.fail("LOAD_FAILED", "Could not read this PDF. It may be encrypted or corrupted.", e instanceof Error ? e.message : undefined);
      }
      const removed: string[] = [];

      if (doMeta) {
        this.report(30, "Scrubbing metadata…");
        const infoKeys = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate", "Trapped"];
        const info = doc.context.lookup(doc.context.trailerInfo.Info) as unknown as { delete?: (k: unknown) => void } | undefined;
        for (const k of infoKeys) {
          try { info?.delete?.(PDFName.of(k)); } catch { /* no info dict */ }
        }
        doc.setTitle(""); doc.setAuthor(""); doc.setSubject("");
        doc.setKeywords([]); doc.setCreator(""); doc.setProducer("");
        const catalog = doc.catalog;
        for (const k of ["Metadata", "PieceInfo"] as const) {
          if (catalog.has(PDFName.of(k))) catalog.delete(PDFName.of(k));
        }
        const trailer = doc.context.trailerInfo as unknown as Record<string, unknown>;
        if ("ID" in trailer) delete trailer.ID;
        removed.push("metadata");
      }

      if (doJs) {
        this.report(50, "Removing scripts & actions…");
        const catalog = doc.catalog;
        const names = catalog.lookup(PDFName.of("Names")) as unknown as {
          has?: (k: unknown) => boolean; delete?: (k: unknown) => void;
        } | undefined;
        try { if (names?.has?.(PDFName.of("JavaScript"))) names.delete?.(PDFName.of("JavaScript")); } catch { /* keep going */ }
        for (const k of ["OpenAction", "AA"] as const) {
          if (catalog.has(PDFName.of(k))) catalog.delete(PDFName.of(k));
        }
        for (const page of doc.getPages()) {
          try {
            const dict = page.node;
            if (dict.has(PDFName.of("AA"))) dict.delete(PDFName.of("AA"));
          } catch { /* keep going */ }
        }
        removed.push("scripts/actions");
      }

      if (doAnnots) {
        this.report(65, "Removing annotations…");
        for (const page of doc.getPages()) {
          try {
            if (page.node.has(PDFName.of("Annots"))) page.node.delete(PDFName.of("Annots"));
          } catch { /* keep going */ }
        }
        removed.push("annotations");
      }

      if (doForms) {
        this.report(75, "Removing forms…");
        if (doc.catalog.has(PDFName.of("AcroForm"))) doc.catalog.delete(PDFName.of("AcroForm"));
        removed.push("forms");
      }

      this.report(90, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_sanitized.pdf`, { removed });
    } catch (e) {
      return this.fail("SANITIZE_FAILED", "Could not sanitize this PDF.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function sanitizePdf(file: File, options: SanitizeOptions = {}, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new SanitizeProcessor().run({ files: [file], options }, onProgress);
}
