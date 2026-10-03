import { BaseLocalProcessor } from "../processor";
import { escXml, buildZip } from "../ooxml";
import { getPageLines } from "../text-lines";
import { loadPdfJs } from "../pdfjs-loader";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
const CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>GlimDocs export</dc:title><dc:creator>GlimDocs (on-device)</dc:creator></cp:coreProperties>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="4F378A"/></w:rPr></w:style></w:styles>`;

function para(text: string, heading: boolean): string {
  const t = escXml(text);
  const pPr = heading ? `<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>` : ``;
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
}

// Short standalone lines (section titles) become Heading 2; everything
// else becomes a body paragraph. Pages separated by page breaks.
function isHeading(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.length <= 70 && !/[.!?:;]$/.test(t) && /[A-Za-z]/.test(t) && t === t.replace(/\s+/g, " ");
}

export class PdfToWordProcessor extends BaseLocalProcessor {
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
      const pdfjs = await loadPdfJs();
      const task = pdfjs.getDocument({ data: bytes.slice() });
      const doc = await task.promise;
      try {
        const total = doc.numPages;
        const targets = wanted.length ? wanted.filter((p) => p <= total) : Array.from({ length: total }, (_, i) => i + 1);
        if (targets.length === 0) return this.fail("INVALID_INPUT", `No valid pages (file has ${total}).`);
        const body: string[] = [];
        for (let i = 0; i < targets.length; i++) {
          if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
          const lines = await getPageLines(bytes.slice(), targets[i]);
          for (const line of lines) {
            if (!line.trim()) continue;
            body.push(para(line.trim().slice(0, 1000), isHeading(line)));
          }
          if (i < targets.length - 1) body.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
          this.report(10 + Math.round(((i + 1) / targets.length) * 60), `Page ${targets[i]}…`);
        }
        this.report(75, "Building DOCX…");
        const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`;
        const zip = await buildZip([
          { name: "[Content_Types].xml", data: CONTENT_TYPES },
          { name: "_rels/.rels", data: RELS },
          { name: "docProps/core.xml", data: CORE },
          { name: "word/styles.xml", data: STYLES },
          { name: "word/document.xml", data: document },
        ]);
        this.report(100, "Done");
        return this.ok(
          new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
          `${baseName(f.name)}.docx`,
          { pages: targets.length }
        );
      } finally {
        await task.destroy();
      }
    } catch (e) {
      return this.fail("WORD_FAILED", "Could not convert this PDF to Word.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function pdfToWord(file: File, options: { pages?: number[] } = {}, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new PdfToWordProcessor().run({ files: [file], options }, onProgress);
}
