import { BaseLocalProcessor } from "../processor";
import { escXml, buildZip } from "../ooxml";
import { getPageTextItems, type TextItem } from "../text-lines";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Spatial table reconstruction on pdf.js text geometry: cluster items into rows by Y, derive column
// edges from x-start gaps, assign cells, then split row runs into separate
// tables on large vertical gaps. One sheet per table: "Table N (Page P)".

interface Row {
  y: number;
  cells: { x: number; str: string }[];
}

function clusterRows(items: TextItem[], yTol = 3): Row[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Row[] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= yTol);
    if (row) row.cells.push({ x: it.x, str: it.str });
    else rows.push({ y: it.y, cells: [{ x: it.x, str: it.str }] });
  }
  for (const r of rows) r.cells.sort((a, b) => a.x - b.x);
  return rows;
}

// Column edges from x-start gaps: a gap wider than both 14pt and 2.5x the
// median item gap starts a new column.
function columnEdges(rows: Row[]): number[] {
  const starts = rows.flatMap((r) => r.cells.map((c) => c.x)).sort((a, b) => a - b);
  if (starts.length === 0) return [];
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const threshold = Math.max(14, median * 2.5);
  const edges = [starts[0]];
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] - starts[i - 1] > threshold) edges.push(starts[i]);
  }
  return edges;
}

function assignCells(rows: Row[], edges: number[]): string[][] {
  return rows.map((row) => {
    const cells = new Array<string>(edges.length).fill("");
    for (const cell of row.cells) {
      let col = 0;
      for (let i = 0; i < edges.length; i++) {
        if (cell.x + 2 >= edges[i]) col = i;
        else break;
      }
      cells[col] = cells[col] ? `${cells[col]} ${cell.str}` : cell.str;
    }
    return cells.map((c) => c.trim());
  });
}

interface Table {
  page: number;
  grid: string[][];
}

// Row runs with >= 2 filled cells form tables; a vertical gap wider than
// 2.5x the median row gap starts a new table.
function splitTables(rows: Row[], grids: string[][], page: number): Table[] {
  const tables: Table[] = [];
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i - 1].y - rows[i].y);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.max(0, Math.floor(sorted.length / 2))] : 12;
  const splitAt = Math.max(24, median * 2.5);
  let current: string[][] = [];
  const flush = () => {
    const kept = current.filter((r) => r.filter(Boolean).length >= 2);
    if (kept.length >= 2) tables.push({ page, grid: kept });
    current = [];
  };
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && rows[i - 1].y - rows[i].y > splitAt) flush();
    current.push(grids[i]);
  }
  flush();
  return tables;
}

function colName(i: number): string {
  let s = "";
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

function sheetName(tableIndex: number, page: number): string {
  return `Table ${tableIndex} (Page ${page})`.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || `Sheet${tableIndex}`;
}

function sheetXml(grid: string[][]): string {
  const cols = Math.max(...grid.map((r) => r.length));
  const rows = grid.slice(0, 20000).map((cells, ri) => {
    const r = ri + 1;
    let xml = `<row r="${r}">`;
    for (let ci = 0; ci < Math.min(cols, 100); ci++) {
      const v = (cells[ci] ?? "").slice(0, 2000);
      const style = ri === 0 ? ` s="1"` : "";
      xml += `<c r="${colName(ci)}${r}" t="inlineStr"${style}><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
    }
    return xml + "</row>";
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF4F378A"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

export class PdfToExcelProcessor extends BaseLocalProcessor {
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
        const tables: Table[] = [];
        for (let i = 0; i < targets.length; i++) {
          if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
          const items = await getPageTextItems(bytes.slice(), targets[i]);
          const nonEmpty = items.filter((t) => t.str.trim());
          if (nonEmpty.length === 0) continue;
          const rows = clusterRows(nonEmpty);
          const edges = columnEdges(rows);
          if (edges.length < 2) continue; // single-column text is not a table
          tables.push(...splitTables(rows, assignCells(rows, edges), targets[i]));
          this.report(10 + Math.round(((i + 1) / targets.length) * 60), `Page ${targets[i]}…`);
        }
        if (tables.length === 0)
          return this.fail(
            "NO_TABLES",
            "No tables detected on these pages. Scanned PDF? OCR ships in a later tier. For raw text use PDF to CSV."
          );
        this.report(75, "Building XLSX…");
        const names = tables.map((t, i) => sheetName(i + 1, t.page));
        const seen = new Set<string>();
        names.forEach((n, i) => {
          let cand = n;
          let k = 2;
          while (seen.has(cand)) cand = `${n.slice(0, 28)} ${k++}`;
          seen.add(cand);
          names[i] = cand;
        });
        const contentTypes = [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`,
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
          ...names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`),
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`].join("");
        const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${escXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
        const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
        const zip = await buildZip([
          { name: "[Content_Types].xml", data: contentTypes },
          { name: "_rels/.rels", data: RELS },
          { name: "xl/workbook.xml", data: workbook },
          { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
          { name: "xl/styles.xml", data: STYLES },
          ...tables.map((t, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(t.grid) })),
        ]);
        this.report(100, "Done");
        const cells = tables.reduce((n, t) => n + t.grid.length * (t.grid[0]?.length ?? 0), 0);
        return this.ok(
          new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          `${baseName(f.name)}.xlsx`,
          { tables: tables.length, pages: targets.length, cells }
        );
      } finally {
        await task.destroy();
      }
    } catch (e) {
      return this.fail("EXCEL_FAILED", "Could not convert this PDF to Excel.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function pdfToExcel(file: File, options: { pages?: number[] } = {}, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new PdfToExcelProcessor().run({ files: [file], options }, onProgress);
}
