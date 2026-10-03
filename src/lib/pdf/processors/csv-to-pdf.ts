import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { toWinAnsi } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type CsvToPdfOptions = {
  headerRow?: boolean;
  landscape?: boolean;
};

// Small RFC-4180-ish parser: quoted fields, escaped quotes, CRLF/newlines
// inside quotes. No dependencies.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

export class CsvToPdfProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const files = input.files;
    if (files.length === 0) return this.fail("INVALID_INPUT", "Please select a CSV file.");
    const f = files[0];
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv")
      return this.fail("INVALID_INPUT", `"${f.name}" is not a CSV file.`);
    const opts = (input.options ?? {}) as CsvToPdfOptions;
    const headerRow = opts.headerRow !== false;
    const landscape = opts.landscape === true;

    try {
      this.report(10, "Parsing CSV…");
      const raw = await f.text();
      const rows = parseCsv(raw).map((r) => r.map((c) => toWinAnsi(c.trim())));
      if (rows.length === 0) return this.fail("INVALID_INPUT", "This CSV has no data rows.");
      if (rows.length > 5000) return this.fail("INVALID_INPUT", "Free plan: up to 5,000 rows per file.");
      const cols = Math.max(...rows.map((r) => r.length));
      if (cols > 20) return this.fail("INVALID_INPUT", "Free plan: up to 20 columns per file.");
      this.report(30, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.create();
      const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
      const fontBold = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
      const PW = landscape ? 841.89 : 595.28;
      const PH = landscape ? 595.28 : 841.89;
      const M = 40;
      const availW = PW - M * 2;
      const colW = availW / cols;
      const size = cols > 8 ? 7 : 9;
      const rowH = size + 9;

      let page = doc.addPage([PW, PH]);
      let y = PH - M;
      let pages = 1;
      const drawRow = (cells: string[], isHeader: boolean, yy: number) => {
        if (isHeader) page.drawRectangle({ x: M, y: yy - 3, width: availW, height: rowH, color: pdfLib.rgb(0.93, 0.9, 0.97) });
        for (let c = 0; c < cols; c++) {
          const cell = (cells[c] ?? "").replace(/\s+/g, " ");
          const fnt = isHeader ? fontBold : font;
          let label = cell;
          while (label && fnt.widthOfTextAtSize(label, size) > colW - 8) label = label.slice(0, -2);
          if (label !== cell && label.length > 3) label = label.slice(0, -1) + "…";
          page.drawText(label, { x: M + c * colW + 4, y: yy + 2, size, font: fnt });
          page.drawRectangle({ x: M + c * colW, y: yy - 3, width: colW, height: rowH, borderColor: pdfLib.rgb(0.75, 0.73, 0.8), borderWidth: 0.75 });
        }
      };

      rows.forEach((r, idx) => {
        if (y - rowH < M) { page = doc.addPage([PW, PH]); y = PH - M; pages++; }
        drawRow(r, headerRow && idx === 0, y - rowH + 3);
        y -= rowH;
        if (this.isCancelled()) throw new Error("__cancelled__");
      });
      this.report(90, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(f.name)}.pdf`, { pages, rows: rows.length, cols });
    } catch (e) {
      if (e instanceof Error && e.message === "__cancelled__") return this.fail("CANCELLED", "Cancelled.");
      return this.fail("CSV_FAILED", "Could not convert this CSV file.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function csvToPdf(file: File, options: CsvToPdfOptions = {}, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new CsvToPdfProcessor().run({ files: [file], options }, onProgress);
}
