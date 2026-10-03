import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Bake AcroForm field values into static page content so the file can no
// longer be edited as a form (also shrinks form overhead).
export class FlattenProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);

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
      let form;
      try {
        form = doc.getForm();
      } catch {
        return this.fail("NO_FORM", "This PDF has no form to flatten.");
      }
      const fields = form.getFields();
      if (fields.length === 0) return this.fail("NO_FORM", "This PDF has no form fields to flatten.");
      this.report(50, `Baking ${fields.length} field(s)…`);
      (form as unknown as { flatten: () => void }).flatten();
      this.report(90, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_flat.pdf`, { fields: fields.length });
    } catch (e) {
      return this.fail("FLATTEN_FAILED", "Could not flatten this PDF.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function flattenPdf(file: File, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new FlattenProcessor().run({ files: [file] }, onProgress);
}
