import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Strip identifying document metadata: Info dictionary (title, author,
// creator, producer, dates), the XMP Metadata stream and PieceInfo.
export class MetadataProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);

    try {
      this.report(20, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const { PDFName } = pdfLib;
      const bytes = await input.files[0].arrayBuffer();
      let doc;
      try {
        doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (e) {
        return this.fail("LOAD_FAILED", "Could not read this PDF. It may be encrypted or corrupted.", e instanceof Error ? e.message : undefined);
      }
      this.report(50, "Stripping metadata…");
      doc.setTitle("");
      doc.setAuthor("");
      doc.setSubject("");
      doc.setKeywords([]);
      doc.setCreator("");
      doc.setProducer("");
      doc.setCreationDate(new Date(0));
      doc.setModificationDate(new Date(0));
      if (doc.catalog.has(PDFName.of("Metadata"))) doc.catalog.delete(PDFName.of("Metadata"));
      if (doc.catalog.has(PDFName.of("PieceInfo"))) doc.catalog.delete(PDFName.of("PieceInfo"));
      this.report(90, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_nometa.pdf`, { stripped: true });
    } catch (e) {
      return this.fail("METADATA_FAILED", "Could not strip metadata from this PDF.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function removeMetadata(file: File, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new MetadataProcessor().run({ files: [file] }, onProgress);
}
