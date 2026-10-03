import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { toWinAnsi } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

type Block =
  | { t: "h1" | "h2" | "h3"; text: string }
  | { t: "li"; text: string; ordered: boolean; num: number }
  | { t: "quote"; text: string }
  | { t: "code"; text: string }
  | { t: "rule" }
  | { t: "p"; text: string };

function isRule(s: string): boolean {
  return /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(s);
}

function isBlockStart(s: string): boolean {
  return (
    /^#{1,3}\s/.test(s) ||
    /^```/.test(s) ||
    /^\s*[-*+]\s/.test(s) ||
    /^\s*\d+[.)]\s/.test(s) ||
    /^\s*>/.test(s) ||
    isRule(s)
  );
}

// Minimal GFM-subset parser: headings, lists, quotes, fenced code,
// horizontal rules, paragraphs + inline **bold** and `code`.
type Span = { text: string; bold: boolean; code: boolean };
function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  let olNum = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push({ t: "code", text: buf.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      blocks.push({ t: h[1].length === 1 ? "h1" : h[1].length === 2 ? "h2" : "h3", text: h[2].trim() });
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { blocks.push({ t: "rule" }); i++; continue; }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) { blocks.push({ t: "li", text: ul[1], ordered: false, num: 0 }); olNum = 0; i++; continue; }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ol) { olNum++; blocks.push({ t: "li", text: ol[2], ordered: true, num: olNum }); i++; continue; }
    olNum = 0;
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { blocks.push({ t: "quote", text: q[1] }); i++; continue; }
    if (!line.trim()) { i++; continue; }
    // Join soft-wrapped paragraph lines.
    const buf = [line.trim()];
    while (i + 1 < lines.length && lines[i + 1].trim() && !isBlockStart(lines[i + 1])) buf.push(lines[++i].trim());
    blocks.push({ t: "p", text: buf.join(" ") });
    i++;
  }
  return blocks;
}

function parseInline(s: string): Span[] {
  const spans: Span[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) spans.push({ text: s.slice(last, m.index), bold: false, code: false });
    const tok = m[0];
    if (tok.startsWith("**")) spans.push({ text: tok.slice(2, -2), bold: true, code: false });
    else spans.push({ text: tok.slice(1, -1), bold: false, code: true });
    last = m.index + tok.length;
  }
  if (last < s.length) spans.push({ text: s.slice(last), bold: false, code: false });
  return spans.length ? spans : [{ text: s, bold: false, code: false }];
}

export class MarkdownToPdfProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const files = input.files;
    if (files.length === 0) return this.fail("INVALID_INPUT", "Please select a Markdown file.");
    const f = files[0];
    if (!/\.m(arkdown|d)$/i.test(f.name)) return this.fail("INVALID_INPUT", `"${f.name}" is not a Markdown file.`);

    try {
      this.report(10, "Parsing Markdown…");
      const raw = await f.text();
      if (!raw.trim()) return this.fail("INVALID_INPUT", "This file has no content.");
      if (raw.length > 300_000) return this.fail("INVALID_INPUT", "Free plan: up to ~300k characters per file.");
      const blocks = parseMarkdown(raw);
      this.report(30, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const doc = await pdfLib.PDFDocument.create();
      const helv = await doc.embedFont(pdfLib.StandardFonts.Helvetica);
      const helvB = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
      const mono = await doc.embedFont(pdfLib.StandardFonts.Courier);
      const W = 595.28;
      const H = 841.89;
      const M = 64;
      const maxW = W - M * 2;
      let page = doc.addPage([W, H]);
      let y = H - M;
      let pages = 1;
      const need = (h: number) => { if (y - h < M) { page = doc.addPage([W, H]); y = H - M; pages++; } };

      const drawSpans = (spans: Span[], size: number, indent: number, color = pdfLib.rgb(0.12, 0.12, 0.12)) => {
        // Greedy word wrap across styled spans.
        const words: { w: string; span: Span }[] = [];
        for (const s of spans) for (const w of toWinAnsi(s.text).split(/(\s+)/)) { if (w) words.push({ w, span: s }); }
        let x = M + indent;
        let firstLine = true;
        const advance = () => { y -= size * 1.5; x = M + indent; firstLine = false; };
        for (const { w, span } of words) {
          if (/^\s+$/.test(w)) {
            const sw = helv.widthOfTextAtSize(" ", size);
            if (x + sw > M + maxW) advance();
            else x += sw;
            continue;
          }
          const font = span.code ? mono : span.bold ? helvB : helv;
          let tok = w;
          // Hard-break tokens wider than the column.
          while (font.widthOfTextAtSize(tok, size) > maxW - indent && tok.length > 1) {
            let k = tok.length;
            while (k > 1 && font.widthOfTextAtSize(tok.slice(0, k), size) > maxW - indent) k--;
            need(size * 1.5);
            if (!firstLine || x > M + indent) advance();
            page.drawText(tok.slice(0, k), { x, y, size, font, color });
            x += font.widthOfTextAtSize(tok.slice(0, k), size);
            tok = tok.slice(k);
            advance();
          }
          const tw = font.widthOfTextAtSize(tok, size);
          if (x + tw > M + maxW) advance();
          need(size * 1.5);
          page.drawText(tok, { x, y, size, font, color });
          x += tw;
        }
        y -= size * 1.5;
      };

      for (const b of blocks) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        if (b.t === "h1" || b.t === "h2" || b.t === "h3") {
          const size = b.t === "h1" ? 22 : b.t === "h2" ? 17 : 14;
          y -= 8;
          drawSpans([{ text: b.text, bold: true, code: false }], size, 0, pdfLib.rgb(0.2, 0.15, 0.45));
          y -= 4;
        } else if (b.t === "rule") {
          need(20); y -= 10;
          page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: pdfLib.rgb(0.7, 0.7, 0.7) });
          y -= 10;
        } else if (b.t === "code") {
          need(20);
          const monoLines = toWinAnsi(b.text).split("\n");
          const boxH = monoLines.length * 13 + 12;
          need(boxH);
          page.drawRectangle({ x: M, y: y - boxH, width: maxW, height: boxH, color: pdfLib.rgb(0.95, 0.94, 0.97) });
          let cy = y - 6;
          for (const cl of monoLines) {
            page.drawText(cl.slice(0, 110), { x: M + 8, y: cy - 9, size: 9, font: mono });
            cy -= 13;
          }
          y -= boxH + 8;
        } else if (b.t === "quote") {
          need(20);
          page.drawRectangle({ x: M, y: y - 4, width: 3, height: 18, color: pdfLib.rgb(0.4, 0.31, 0.64) });
          drawSpans(parseInline(b.text), 11, 12, pdfLib.rgb(0.35, 0.33, 0.4));
        } else if (b.t === "li") {
          const bullet = b.ordered ? `${b.num}. ` : "• ";
          drawSpans([{ text: bullet + b.text, bold: false, code: false }], 11, 16);
        } else {
          drawSpans(parseInline(b.text), 11, 0);
          y -= 4;
        }
      }
      this.report(90, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(f.name)}.pdf`, { pages, blocks: blocks.length });
    } catch (e) {
      return this.fail("MARKDOWN_FAILED", "Could not convert this Markdown file.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function markdownToPdf(file: File, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new MarkdownToPdfProcessor().run({ files: [file] }, onProgress);
}
