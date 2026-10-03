import { BaseLocalProcessor } from "../processor";
import { getPageLines } from "../text-lines";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

function splitColumns(line: string): string[] {
  const parts = line.split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [line.trim()];
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Heuristic table dump: text lines → rows, wide gaps/tabs → columns.
export class PdfToCsvProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const files = input.files;
    if (files.length === 0) return this.fail("INVALID_INPUT", "Please select a PDF file.");
    const f = files[0];
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name))
      return this.fail("INVALID_INPUT", `"${f.name}" is not a PDF file.`);
    const wanted = ((input.options?.pages ?? []) as number[]).filter((p) => Number.isFinite(p) && p >= 1);

    try {
      this.report(10, "Reading PDF text…");
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { loadPdfJs } = await import("../pdfjs-loader");
      const pdfjs = await loadPdfJs();
      const task = pdfjs.getDocument({ data: bytes.slice() });
      const doc = await task.promise;
      try {
        const total = doc.numPages;
        const targets = wanted.length ? wanted.filter((p) => p <= total) : Array.from({ length: total }, (_, i) => i + 1);
        if (targets.length === 0) return this.fail("INVALID_INPUT", `No valid pages (file has ${total}).`);
        const out: string[] = [];
        for (let i = 0; i < targets.length; i++) {
          if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
          const lines = await getPageLines(bytes.slice(), targets[i]);
          for (const line of lines) {
            if (!line.trim()) continue;
            out.push(splitColumns(line).map((c) => csvCell(c.slice(0, 2000))).join(","));
          }
          this.report(10 + Math.round(((i + 1) / targets.length) * 80), `Page ${targets[i]}…`);
        }
        if (out.length === 0) return this.fail("NO_TEXT", "No extractable text on these pages (scanned PDF? OCR ships in a later tier).");
        this.report(100, "Done");
        return this.ok(new Blob([out.join("\n")], { type: "text/csv" }), `${baseName(f.name)}.csv`, { rows: out.length, pages: targets.length });
      } finally {
        await task.destroy();
      }
    } catch (e) {
      return this.fail("CSV_FAILED", "Could not convert this PDF to CSV.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function pdfToCsv(file: File, options: { pages?: number[] } = {}, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new PdfToCsvProcessor().run({ files: [file], options }, onProgress);
}
