import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { toWinAnsi } from "../validation";
import { unzipFiles, xmlUnescape } from "../ooxml-read";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// DOCX → PDF content converter (zero deps): unzips word/document.xml and
// renders paragraphs (headings, bold/italic, size, color, bullets) and simple
// text tables. This is a content conversion — exact Word pagination, images,
// and complex layouts are out of scope and noted on the tool page.

interface Span {
  text: string;
  bold: boolean;
  italic: boolean;
  size: number | null;
  color: [number, number, number] | null;
}

type Block =
  | { kind: "para"; style: "title" | "h1" | "h2" | "h3" | "body"; bullet: boolean; spans: Span[] }
  | { kind: "table"; rows: string[][] };

function parseColor(hex: string | null): [number, number, number] | null {
  if (!hex || !/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255];
}

function parseRuns(pXml: string): Span[] {
  const spans: Span[] = [];
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let rm: RegExpExecArray | null;
  while ((rm = runRe.exec(pXml)) !== null) {
    const rXml = rm[1];
    const prMatch = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(rXml);
    const pr = prMatch ? prMatch[1] : "";
    const bold = /<w:b(?:\s|\/|>)/.test(pr);
    const italic = /<w:i(?:\s|\/|>)/.test(pr);
    const szMatch = /<w:sz\s[^>]*w:val="(\d+)"/.exec(pr);
    const colorMatch = /<w:color\s[^>]*w:val="([0-9a-fA-F]+)"/.exec(pr);
    let text = "";
    const tRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRe.exec(rXml)) !== null) {
      if (tm[0].startsWith("<w:tab")) text += "  ";
      else if (tm[0].startsWith("<w:br")) text += "\n";
      else text += xmlUnescape(tm[1] ?? "");
    }
    if (text) {
      spans.push({
        text: toWinAnsi(text),
        bold,
        italic,
        size: szMatch ? Math.min(28, Math.max(7, parseInt(szMatch[1], 10) / 2)) : null,
        color: colorMatch ? parseColor(colorMatch[1]) : null,
      });
    }
  }
  return spans;
}

function parseDocument(xml: string): Block[] {
  const blocks: Block[] = [];
  const bodyMatch = /<w:body>([\s\S]*)<\/w:body>/.exec(xml);
  const body = bodyMatch ? bodyMatch[1] : xml;
  const partRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:tbl(?:\s[^>]*)?>([\s\S]*?)<\/w:tbl>/g;
  let m: RegExpExecArray | null;
  while ((m = partRe.exec(body)) !== null && blocks.length < 6000) {
    if (m[1] !== undefined) {
      const pXml = m[1];
      const styleMatch = /<w:pStyle\s[^>]*w:val="([^"]+)"/.exec(pXml);
      const styleVal = (styleMatch ? styleMatch[1] : "").toLowerCase();
      const style =
        styleVal.includes("title") ? "title"
        : styleVal.includes("heading1") ? "h1"
        : styleVal.includes("heading2") ? "h2"
        : styleVal.includes("heading3") ? "h3"
        : "body";
      // Word list paragraphs carry numbering properties; render with a bullet.
      const bullet = /<w:numPr[\s>]/.test(pXml);
      const spans = parseRuns(pXml);
      if (spans.some((s) => s.text.trim())) blocks.push({ kind: "para", style, bullet, spans });
    } else if (m[2] !== undefined) {
      const rows: string[][] = [];
      const trRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
      let trm: RegExpExecArray | null;
      while ((trm = trRe.exec(m[2])) !== null && rows.length < 200) {
        const cells: string[] = [];
        const tcRe = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
        let tcm: RegExpExecArray | null;
        while ((tcm = tcRe.exec(trm[1])) !== null && cells.length < 20) {
          const texts: string[] = [];
          const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
          let pm: RegExpExecArray | null;
          while ((pm = pRe.exec(tcm[1])) !== null) {
            const t = parseRuns(pm[1]).map((s) => s.text).join("").replace(/\s+/g, " ").trim();
            if (t) texts.push(t);
          }
          cells.push(toWinAnsi(texts.join(" ").slice(0, 500)));
        }
        if (cells.some((c) => c)) rows.push(cells);
      }
      if (rows.length > 0) blocks.push({ kind: "table", rows });
    }
  }
  return blocks;
}

export class WordToPdfProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const files = input.files;
    if (files.length === 0) return this.fail("INVALID_INPUT", "Please select a .docx file.");
    const f = files[0];
    if (!/\.docx$/i.test(f.name))
      return this.fail("INVALID_INPUT", `"${f.name}" is not a Word (.docx) file.`);

    try {
      this.report(10, "Reading DOCX…");
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
        return this.fail("INVALID_INPUT", "This file is not a valid .docx archive.");
      if (bytes.length > 25 * 1024 * 1024)
        return this.fail("INVALID_INPUT", "Free plan: up to 25MB per file.");
      const entries = await unzipFiles(bytes);
      const docXmlBytes = entries.get("word/document.xml");
      if (!docXmlBytes) return this.fail("INVALID_INPUT", "No word/document.xml found — not a Word document.");
      const blocks = parseDocument(new TextDecoder().decode(docXmlBytes));
      if (blocks.length === 0) return this.fail("NO_TEXT", "No readable paragraphs or tables found in this document.");

      this.report(35, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.create();
      const fonts = {
        reg: await doc.embedFont(pdfLib.StandardFonts.Helvetica),
        bold: await doc.embedFont(pdfLib.StandardFonts.HelveticaBold),
        ital: await doc.embedFont(pdfLib.StandardFonts.HelveticaOblique),
        boldItal: await doc.embedFont(pdfLib.StandardFonts.HelveticaBoldOblique),
      };
      const W = 595.28;
      const H = 841.89;
      const M = 64;
      const maxW = W - M * 2;
      const ACCENT = pdfLib.rgb(0.31, 0.2, 0.54);

      let page = doc.addPage([W, H]);
      let y = H - M;
      let pages = 1;
      const need = (h: number) => {
        if (y - h < M) {
          page = doc.addPage([W, H]);
          y = H - M;
          pages++;
        }
      };

      // Rich paragraph renderer: flows styled words across lines.
      const drawPara = (
        spans: Span[],
        baseSize: number,
        baseFont: (typeof fonts)["reg"],
        baseColor: unknown,
        indent: number
      ) => {
        const words: { w: string; font: (typeof fonts)["reg"]; size: number; color: unknown }[] = [];
        for (const s of spans) {
          const size = s.size ?? baseSize;
          const font = s.bold && s.italic ? fonts.boldItal : s.bold ? fonts.bold : s.italic ? fonts.ital : baseFont;
          const color = s.color ? pdfLib.rgb(s.color[0], s.color[1], s.color[2]) : baseColor;
          for (const chunk of s.text.split("\n")) {
            for (const w of chunk.split(/\s+/).filter(Boolean)) words.push({ w, font, size, color });
            words.push({ w: "\n", font, size: 0, color: null });
          }
        }
        let line: typeof words = [];
        let lineW = 0;
        const lineHFor = (ln: typeof words) =>
          ln.reduce((m, t) => Math.max(m, t.size), baseSize) * 1.4;
        const flush = () => {
          if (line.length === 0) return;
          const lh = lineHFor(line);
          need(lh);
          let x = M + indent;
          for (const t of line) {
            if (t.w === "\n") continue;
            const glyph: { x: number; y: number; size: number; font: typeof t.font; color?: unknown } = {
              x,
              y: y - lh + 4,
              size: t.size,
              font: t.font,
            };
            if (t.color) glyph.color = t.color;
            page.drawText(t.w, glyph as never);
            x += t.font.widthOfTextAtSize(t.w, t.size) + t.font.widthOfTextAtSize(" ", t.size);
          }
          y -= lh;
          line = [];
          lineW = 0;
        };
        for (const t of words) {
          if (t.w === "\n") {
            flush();
            continue;
          }
          const ww = t.font.widthOfTextAtSize(t.w, t.size) + t.font.widthOfTextAtSize(" ", t.size);
          if (lineW + ww > maxW - indent && line.length > 0) flush();
          line.push(t);
          lineW += ww;
        }
        flush();
      };

      const drawTable = (rows: string[][]) => {
        const cols = Math.min(8, Math.max(...rows.map((r) => r.length)));
        if (cols <= 0) return;
        const colW = maxW / cols;
        const size = 9;
        const wrapCell = (text: string): string[] => {
          const words = text.split(/\s+/).filter(Boolean);
          if (!words.length) return [""];
          const out: string[] = [];
          let cur = "";
          for (const w of words) {
            const trial = cur ? cur + " " + w : w;
            if (fonts.reg.widthOfTextAtSize(trial, size) <= colW - 8) cur = trial;
            else {
              if (cur) out.push(cur);
              cur = w.length > 30 ? w.slice(0, 30) : w;
            }
          }
          if (cur) out.push(cur);
          return out;
        };
        rows.forEach((cells, ri) => {
          const wrapped = Array.from({ length: cols }, (_, c) => wrapCell(cells[c] ?? ""));
          const rh = Math.max(...wrapped.map((w) => w.length)) * (size + 6) + 6;
          need(rh);
          const top = y;
          for (let c = 0; c < cols; c++) {
            if (ri === 0)
              page.drawRectangle({ x: M + c * colW, y: top - rh, width: colW, height: rh, color: pdfLib.rgb(0.93, 0.9, 0.97) });
            wrapped[c].forEach((ln, li) => {
              page.drawText(ln, {
                x: M + c * colW + 4,
                y: top - 8 - li * (size + 6),
                size,
                font: ri === 0 ? fonts.bold : fonts.reg,
              });
            });
            page.drawRectangle({ x: M + c * colW, y: top - rh, width: colW, height: rh, borderColor: pdfLib.rgb(0.75, 0.73, 0.8), borderWidth: 0.75 });
          }
          y = top - rh - 4;
          if (this.isCancelled()) throw new Error("__cancelled__");
        });
        y -= 6;
      };

      let paraCount = 0;
      let tableCount = 0;
      for (const b of blocks) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        if (b.kind === "table") {
          tableCount++;
          need(20);
          drawTable(b.rows);
          continue;
        }
        paraCount++;
        const cfg: { size: number; font: (typeof fonts)["reg"]; color: unknown; gap: number } =
          b.style === "title" ? { size: 20, font: fonts.bold, color: ACCENT, gap: 14 }
          : b.style === "h1" ? { size: 17, font: fonts.bold, color: ACCENT, gap: 12 }
          : b.style === "h2" ? { size: 14, font: fonts.bold, color: ACCENT, gap: 10 }
          : b.style === "h3" ? { size: 12, font: fonts.bold, color: null, gap: 8 }
          : { size: 11, font: fonts.reg, color: null, gap: 5 };
        y -= cfg.gap * 0.4;
        const spans = b.bullet
          ? [{ text: "•  ", bold: false, italic: false, size: cfg.size, color: null }, ...b.spans]
          : b.spans;
        drawPara(spans, cfg.size, cfg.font, cfg.color, b.bullet ? 14 : 0);
        y -= cfg.gap * 0.6;
      }

      this.report(90, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(
        new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
        `${baseName(f.name)}.pdf`,
        { pages, paragraphs: paraCount, tables: tableCount }
      );
    } catch (e) {
      if (e instanceof Error && e.message === "__cancelled__") return this.fail("CANCELLED", "Cancelled.");
      return this.fail("WORD_FAILED", "Could not convert this Word file.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function wordToPdf(file: File, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new WordToPdfProcessor().run({ files: [file], options: {} }, onProgress);
}
