import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { toWinAnsi } from "../validation";
import { unzipFiles, xmlUnescape } from "../ooxml-read";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// XLSX → PDF content converter (zero deps): reads shared strings, sheet
// names, and cell grids from the archive, then renders each worksheet as
// bordered tables. Formulas render as cached values; charts and images are
// out of scope and noted on the tool page.

function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const tRe = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g;
    let tm: RegExpExecArray | null;
    let text = "";
    while ((tm = tRe.exec(m[1])) !== null) text += xmlUnescape(tm[1]);
    out.push(text);
  }
  return out;
}

function sheetNameList(workbookXml: string): string[] {
  const names: string[] = [];
  const re = /<sheet[^>]*name="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(workbookXml)) !== null) names.push(xmlUnescape(m[1]));
  return names;
}

// Map workbook sheet order → worksheet file via the .rels (falls back to
// the conventional sheetN.xml naming when rels are missing).
function sheetFiles(workbookXml: string, relsXml: string, count: number): string[] {
  const targets = new Map<string, string>();
  const re = /<Relationship\s[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*Type="[^"]*worksheet"|<Relationship\s[^>]*Target="([^"]+)"[^>]*Type="[^"]*worksheet"[^>]*Id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(relsXml)) !== null) {
    const id = m[1] ?? m[4];
    const target = m[2] ?? m[3];
    if (id && target) targets.set(id, target.replace(/^xl\//, "").replace(/^\//, ""));
  }
  const idRe = /<sheet[^>]*r:id="([^"]+)"/g;
  const ids: string[] = [];
  while ((m = idRe.exec(workbookXml)) !== null) ids.push(m[1]);
  const files: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = targets.get(ids[i] ?? "");
    files.push(t ? (t.startsWith("worksheets/") ? `xl/${t}` : `xl/worksheets/${t}`) : `xl/worksheets/sheet${i + 1}.xml`);
  }
  return files;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const grid = new Map<number, Map<number, string>>();
  let maxRow = -1;
  let maxCol = -1;
  const cellRe = /<c\s+r="([A-Z]+)(\d+)"(?:\s+t="([^"]*)")?[^>]*>(?:<v>([^<]*)<\/v>|<is>([\s\S]*?)<\/is>)?/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml)) !== null) {
    if (maxRow > 2000 || maxCol > 60) break;
    const col = colLettersToIndex(m[1]);
    const row = parseInt(m[2], 10) - 1;
    if (row < 0 || col < 0 || row > 5000 || col > 100) continue;
    let value = "";
    if (m[3] === "s") {
      const idx = parseInt(m[4] ?? "-1", 10);
      value = Number.isFinite(idx) && shared[idx] !== undefined ? shared[idx] : "";
    } else if (m[3] === "inlineStr") {
      const tRe = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g;
      let tm: RegExpExecArray | null;
      while ((tm = tRe.exec(m[5] ?? "")) !== null) value += xmlUnescape(tm[1]);
    } else if (m[3] === "b") {
      value = (m[4] ?? "0") === "0" ? "FALSE" : "TRUE";
    } else {
      value = xmlUnescape(m[4] ?? "");
    }
    if (!grid.has(row)) grid.set(row, new Map());
    grid.get(row)!.set(col, value);
    if (value.trim()) {
      maxRow = Math.max(maxRow, row);
      maxCol = Math.max(maxCol, col);
    }
  }
  if (maxRow < 0 || maxCol < 0) return [];
  const rows: string[][] = [];
  for (let r = 0; r <= Math.min(maxRow, 2000); r++) {
    const rowMap = grid.get(r);
    const row: string[] = [];
    for (let c = 0; c <= Math.min(maxCol, 60); c++) row.push(toWinAnsi((rowMap?.get(c) ?? "").replace(/\s+/g, " ").trim()));
    rows.push(row);
  }
  // Drop fully-empty trailing rows.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return rows;
}

export class ExcelToPdfProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const files = input.files;
    if (files.length === 0) return this.fail("INVALID_INPUT", "Please select an .xlsx file.");
    const f = files[0];
    if (!/\.xlsx$/i.test(f.name))
      return this.fail("INVALID_INPUT", `"${f.name}" is not an Excel (.xlsx) file.`);

    try {
      this.report(10, "Reading XLSX…");
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        return this.fail("INVALID_INPUT", "This file is not a valid .xlsx archive.");
      if (bytes.length > 25 * 1024 * 1024)
        return this.fail("INVALID_INPUT", "Free plan: up to 25MB per file.");
      const entries = await unzipFiles(bytes);
      const dec = new TextDecoder();
      const get = (n: string) => {
        const b = entries.get(n);
        return b ? dec.decode(b) : "";
      };
      const workbookXml = get("xl/workbook.xml");
      if (!workbookXml) return this.fail("INVALID_INPUT", "No xl/workbook.xml found — not an Excel workbook.");
      const shared = parseSharedStrings(get("xl/sharedStrings.xml"));
      const names = sheetNameList(workbookXml);
      const filesForSheets = sheetFiles(workbookXml, get("xl/_rels/workbook.xml.rels"), Math.max(names.length, 1));
      const sheets: { name: string; grid: string[][] }[] = [];
      for (let i = 0; i < filesForSheets.length; i++) {
        const xml = get(filesForSheets[i]);
        if (!xml) continue;
        const grid = parseSheet(xml, shared);
        if (grid.length > 0) sheets.push({ name: toWinAnsi((names[i] || `Sheet${i + 1}`).slice(0, 60)), grid });
        if (sheets.reduce((n, s) => n + s.grid.length, 0) > 5000) break;
      }
      if (sheets.length === 0) return this.fail("NO_TEXT", "No readable cell data found in this workbook.");

      this.report(40, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.create();
      const font = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
      const fontBold = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
      const PW = 841.89;
      const PH = 595.28;
      const M = 36;
      const availW = PW - M * 2;

      let pageCount = 0;
      let totalRows = 0;
      for (let si = 0; si < sheets.length; si++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const { name, grid } = sheets[si];
        const cols = Math.min(20, Math.max(...grid.map((r) => r.length)));
        const trimmed = grid.map((r) => r.slice(0, cols));
        const colW = availW / cols;
        const size = cols > 10 ? 7 : 9;
        const rowH = size + 9;
        let page = doc.addPage([PW, PH]);
        let y = PH - M;
        pageCount++;
        // Sheet title band.
        page.drawRectangle({ x: M, y: y - 18, width: availW, height: 24, color: pdfLib.rgb(0.31, 0.2, 0.54) });
        let title = name;
        while (title && fontBold.widthOfTextAtSize(title, 12) > availW - 16) title = title.slice(0, -2);
        page.drawText(title, { x: M + 8, y: y - 12, size: 12, font: fontBold, color: pdfLib.rgb(1, 1, 1) });
        y -= 34;
        totalRows += trimmed.length;
        this.report(40 + Math.round(((si + 1) / sheets.length) * 45), `${name}…`);

        const drawRow = (cells: string[], isHeader: boolean, yy: number) => {
          if (isHeader)
            page.drawRectangle({ x: M, y: yy - 3, width: availW, height: rowH, color: pdfLib.rgb(0.93, 0.9, 0.97) });
          for (let c = 0; c < cols; c++) {
            const cell = cells[c] ?? "";
            const fnt = isHeader ? fontBold : font;
            let label = cell;
            while (label && fnt.widthOfTextAtSize(label, size) > colW - 8) label = label.slice(0, -2);
            if (label !== cell && label.length > 3) label = label.slice(0, -1) + "…";
            page.drawText(label, { x: M + c * colW + 4, y: yy + 2, size, font: fnt });
            page.drawRectangle({ x: M + c * colW, y: yy - 3, width: colW, height: rowH, borderColor: pdfLib.rgb(0.75, 0.73, 0.8), borderWidth: 0.75 });
          }
        };
        trimmed.forEach((r, idx) => {
          if (y - rowH < M) {
            page = doc.addPage([PW, PH]);
            y = PH - M;
            pageCount++;
          }
          drawRow(r, idx === 0, y - rowH + 3);
          y -= rowH;
        });
      }

      this.report(90, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(
        new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
        `${baseName(f.name)}.pdf`,
        { pages: pageCount, sheets: sheets.length, rows: totalRows }
      );
    } catch (e) {
      if (e instanceof Error && e.message === "__cancelled__") return this.fail("CANCELLED", "Cancelled.");
      return this.fail("EXCEL_FAILED", "Could not convert this Excel file.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function excelToPdf(file: File, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new ExcelToPdfProcessor().run({ files: [file], options: {} }, onProgress);
}
