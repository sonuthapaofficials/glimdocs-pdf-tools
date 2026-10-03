import { BaseLocalProcessor } from "../processor";
import { loadPdfJs } from "../pdfjs-loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

interface TextItem {
  str: string;
  hasEOL?: boolean;
}

// Extract raw text per page. pdf.js loads only when this tool runs.
export class PdfToTextProcessor extends BaseLocalProcessor {
  async run(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const wanted = (input.options?.pages as number[] | undefined) ?? [];
    const asJson = Boolean(input.options?.asJson);
    const asMarkdown = Boolean(input.options?.asMarkdown);

    try {
      this.report(5, "Loading text engine…");
      const pdfjs = await loadPdfJs();
      const bytes = new Uint8Array(await input.files[0].arrayBuffer());
      this.report(10, "Opening PDF…");
      const loadingTask = pdfjs.getDocument({ data: bytes });
      const doc = await loadingTask.promise;
      const total = doc.numPages;
      const targets =
        wanted.length === 0
          ? Array.from({ length: total }, (_, i) => i + 1)
          : wanted.filter((p) => p >= 1 && p <= total);
      if (targets.length === 0) {
        await loadingTask.destroy();
        return this.fail("INVALID_INPUT", `No valid pages in 1–${total}.`);
      }

      const pages: { page: number; text: string }[] = [];
      for (let i = 0; i < targets.length; i++) {
        if (this.isCancelled()) {
          await loadingTask.destroy();
          return this.fail("CANCELLED", "Cancelled.");
        }
        this.report(10 + (i / targets.length) * 85, `Reading page ${targets[i]}…`);
        const page = await doc.getPage(targets[i]);
        const content = await page.getTextContent();
        let text = "";
        for (const raw of content.items as TextItem[]) {
          text += raw.str;
          text += raw.hasEOL ? "\n" : " ";
        }
        pages.push({ page: targets[i], text: text.trim() });
        page.cleanup();
      }
      await loadingTask.destroy();

      this.report(100, "Done");
      const stem = baseName(input.files[0].name);
      if (asJson) {
        const blob = new Blob(
          [JSON.stringify({ source: input.files[0].name, pages }, null, 2)],
          { type: "application/json" }
        );
        return this.ok(blob, `${stem}.json`, { pageCount: pages.length });
      }
      if (asMarkdown) {
        const md = [`# ${stem}`, ""];
        for (const p of pages) {
          md.push(`## Page ${p.page}`, "", p.text || "*(no text)*", "");
        }
        const blob = new Blob([md.join("\n")], { type: "text/markdown;charset=utf-8" });
        return this.ok(blob, `${stem}.md`, { pageCount: pages.length });
      }
      const text = pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join("\n\n");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      return this.ok(blob, `${stem}.txt`, { pageCount: pages.length });
    } catch (e) {
      return this.fail(
        "EXTRACT_FAILED",
        "Could not extract text from this PDF.",
        e instanceof Error ? e.message : undefined
      );
    }
  }
}

export async function pdfToText(
  file: File,
  opts: { pages?: number[]; asJson?: boolean; asMarkdown?: boolean } = {},
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new PdfToTextProcessor().run({ files: [file], options: opts }, onProgress);
}
