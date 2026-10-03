import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export interface FormFieldInfo {
  name: string;
  type: "text" | "checkbox" | "dropdown" | "radio" | "button" | "other";
  value: string | boolean | null;
  options?: string[];
}

async function loadForm(file: File) {
  const pdfLib = await loadPdfLib();
  const bytes = await file.arrayBuffer();
  const doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
  return { pdfLib, doc };
}

function describeField(pdfLib: Awaited<ReturnType<typeof loadPdfLib>>, field: { constructor: { name: string }; getName(): string }): FormFieldInfo {
  const name = field.getName();
  const f = field as unknown as Record<string, unknown>;
  if (field instanceof pdfLib.PDFTextField) {
    return { name, type: "text", value: (f.getText as () => string | undefined)?.() ?? null };
  }
  if (field instanceof pdfLib.PDFCheckBox) {
    return { name, type: "checkbox", value: (f.isChecked as () => boolean)?.() ?? false };
  }
  if (field instanceof pdfLib.PDFDropdown) {
    return {
      name, type: "dropdown",
      value: ((f.getSelected as () => string[])?.()[0]) ?? null,
      options: (f.getOptions as () => string[])?.() ?? [],
    };
  }
  if (field instanceof pdfLib.PDFRadioGroup) {
    return {
      name, type: "radio",
      value: (f.getSelected as () => string | undefined)?.() ?? null,
      options: (f.getOptions as () => string[])?.() ?? [],
    };
  }
  if (field instanceof pdfLib.PDFButton) return { name, type: "button", value: null };
  return { name, type: "other", value: null };
}

// List interactive (AcroForm) fields so the UI can render one input per field.
export async function listFormFields(file: File): Promise<FormFieldInfo[]> {
  const err = validateFiles([file], { min: 1, max: 1, kind: "pdf" });
  if (err) throw new Error(err);
  const { pdfLib, doc } = await loadForm(file);
  try {
    return doc.getForm().getFields().map((f) => describeField(pdfLib, f as unknown as { constructor: { name: string }; getName(): string }));
  } catch {
    return [];
  }
}

// Fill AcroForm text boxes, checkboxes, dropdowns and radio groups.
export class FormFillProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const values = (input.options?.values ?? {}) as Record<string, string | boolean>;

    try {
      this.report(10, "Loading PDF engine…");
      const { pdfLib, doc } = await loadForm(input.files[0]);
      const form = doc.getForm();
      const fields = form.getFields();
      if (fields.length === 0) return this.fail("NO_FIELDS", "This PDF has no fillable form fields.");
      let filled = 0;
      for (const field of fields) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        if (!(field.getName() in values)) continue;
        const v = values[field.getName()];
        try {
          if (field instanceof pdfLib.PDFTextField && typeof v === "string") { field.setText(v.slice(0, 2000)); filled++; }
          else if (field instanceof pdfLib.PDFCheckBox) { if (v === true || v === "true") field.check(); else field.uncheck(); filled++; }
          else if (field instanceof pdfLib.PDFDropdown && typeof v === "string") { field.select(v); filled++; }
          else if (field instanceof pdfLib.PDFRadioGroup && typeof v === "string") { field.select(v); filled++; }
        } catch {
          /* unsupported value for this field — skip */
        }
        this.report(10 + Math.round((filled / Math.max(1, fields.length)) * 70), `Filling ${filled} field(s)…`);
      }
      this.report(85, "Updating appearances…");
      form.updateFieldAppearances();
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_filled.pdf`, { fields: fields.length, filled });
    } catch (e) {
      return this.fail("FORM_FILL_FAILED", "Could not fill this form.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function fillPdfForm(file: File, values: Record<string, string | boolean>, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new FormFillProcessor().run({ files: [file], options: { values } }, onProgress);
}
