import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { loadPdfJs } from "../pdfjs-loader";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export interface BookmarkNode {
  id: string;
  title: string;
  page: number;
  children: BookmarkNode[];
}

let bmSeq = 0;
export function newBookmarkId(): string {
  bmSeq += 1;
  return `bm-${Date.now().toString(36)}-${bmSeq}`;
}

function cleanTitle(s: unknown): string {
  // Strip C0/C1 control characters. Written with charCodeAt on purpose:
  // hex-escape regex literals risk smuggling raw control bytes into source.
  return String(s ?? '')
    .split('')
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return (c >= 32 && c < 127) || c >= 160;
    })
    .join('')
    .trim();
}


// Read the existing outline via the pdf.js document API (no canvas needed,
// so this also runs in the Node test harness).
export async function readBookmarks(file: File): Promise<BookmarkNode[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    let outline: Array<{
      title?: unknown;
      dest?: unknown;
      items?: unknown;
    }> | null = null;
    try {
      outline = (await doc.getOutline()) as Array<{
        title?: unknown;
        dest?: unknown;
        items?: unknown;
      }> | null;
    } catch {
      return [];
    }
    if (!outline || outline.length === 0) return [];
    const resolvePage = async (dest: unknown): Promise<number> => {
      try {
        let d = dest as string | Array<unknown> | null | undefined;
        if (typeof d === "string") d = (await doc.getDestination(d)) as Array<unknown> | null;
        if (Array.isArray(d) && d.length > 0) {
          const idx = await doc.getPageIndex(d[0] as never);
          if (Number.isFinite(idx) && idx >= 0) return idx + 1;
        }
      } catch {
        // Unresolvable destination: fall back to page 1.
      }
      return 1;
    };
    const walk = async (items: unknown): Promise<BookmarkNode[]> => {
      const out: BookmarkNode[] = [];
      if (!Array.isArray(items)) return out;
      for (const raw of items as Array<{
        title?: unknown;
        dest?: unknown;
        items?: unknown;
      }>) {
        out.push({
          id: newBookmarkId(),
          title: cleanTitle(raw.title) || "Untitled",
          page: await resolvePage(raw.dest),
          children: await walk(raw.items),
        });
      }
      return out;
    };
    return await walk(outline);
  } finally {
    await task.destroy();
  }
}

type RawNode = { title?: unknown; page?: unknown; children?: unknown };

function sanitizeTree(raw: unknown, depth = 0): BookmarkNode[] {
  if (!Array.isArray(raw) || depth > 12) return [];
  const out: BookmarkNode[] = [];
  for (const r of raw.slice(0, 2000) as RawNode[]) {
    if (!r || typeof r !== "object") continue;
    const page = Math.floor(Number((r as RawNode).page));
    out.push({
      id: newBookmarkId(),
      title: cleanTitle((r as RawNode).title).slice(0, 500) || "Untitled",
      page: Number.isFinite(page) && page >= 1 ? page : 1,
      children: sanitizeTree((r as RawNode).children, depth + 1),
    });
  }
  return out;
}

function countAll(nodes: BookmarkNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countAll(node.children);
  return n;
}

// Rebuild the document outline from an edited tree. Existing outlines are
// dropped first; an empty tree strips bookmarks entirely. Destinations use
// explicit /Fit, which every viewer honors.
export class BookmarksProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const files = input.files;
    if (files.length === 0) return this.fail("INVALID_INPUT", "Please select a PDF file.");
    const f = files[0];
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name))
      return this.fail("INVALID_INPUT", `"${f.name}" is not a PDF file.`);
    const tree = sanitizeTree(input.options?.bookmarks);

    try {
      this.report(15, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = new Uint8Array(await f.arrayBuffer());
      const doc = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = doc.getPages();
      if (pages.length === 0) return this.fail("INVALID_INPUT", "This PDF has no pages.");
      const ctx = doc.context;
      const { PDFName, PDFHexString, PDFNumber, PDFArray } = pdfLib;

      try {
        doc.catalog.delete(PDFName.of("Outlines"));
      } catch {
        // No pre-existing outline entry.
      }

      if (tree.length > 0) {
        this.report(45, "Rebuilding outline…");
        const outlinesDict = ctx.obj({});
        const outlinesRef = ctx.register(outlinesDict);

        // Structural dict type: avoids PDFDict's protected constructor
        // tripping InstanceType while keeping set() fully typed at use.
        interface OutlineEntry {
          ref: unknown;
          dict: { set: (key: never, value: never) => unknown };
        }
        const buildLevel = (
          nodes: BookmarkNode[],
          parentRef: unknown
        ): OutlineEntry[] => {
          const level: OutlineEntry[] = [];
          for (const node of nodes) {
            if (this.isCancelled()) throw new Error("__cancelled__");
            const dict = ctx.obj({});
            const ref = ctx.register(dict);
            dict.set(PDFName.of("Title"), PDFHexString.fromText(node.title));
            dict.set(PDFName.of("Parent"), parentRef as never);
            const pageIdx = Math.max(0, Math.min(node.page - 1, pages.length - 1));
            // Explicit /Fit destination: valid with zero null-object
            // plumbing and honored by every viewer.
            const dest = PDFArray.withContext(ctx);
            dest.push(pages[pageIdx].ref);
            dest.push(PDFName.of("Fit"));
            dict.set(PDFName.of("Dest"), dest);
            const kids = buildLevel(node.children, ref);
            if (kids.length > 0) {
              dict.set(PDFName.of("First"), kids[0].ref as never);
              dict.set(PDFName.of("Last"), kids[kids.length - 1].ref as never);
              dict.set(PDFName.of("Count"), PDFNumber.of(countAll(node.children)));
            }
            const prev = level[level.length - 1];
            if (prev) {
              dict.set(PDFName.of("Prev"), prev.ref as never);
              prev.dict.set(PDFName.of("Next") as never, ref as never);
            }
            level.push({ ref, dict });
          }
          return level;
        };

        const top = buildLevel(tree, outlinesRef);
        outlinesDict.set(PDFName.of("Type"), PDFName.of("Outlines"));
        outlinesDict.set(PDFName.of("First"), top[0].ref as never);
        outlinesDict.set(PDFName.of("Last"), top[top.length - 1].ref as never);
        outlinesDict.set(PDFName.of("Count"), PDFNumber.of(countAll(tree)));
        doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
      }

      this.report(85, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      const total = countAll(tree);
      return this.ok(
        new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
        `${baseName(f.name)}-bookmarks.pdf`,
        { bookmarks: total, stripped: tree.length === 0 }
      );
    } catch (e) {
      if (e instanceof Error && e.message === "__cancelled__")
        return this.fail("CANCELLED", "Cancelled.");
      return this.fail("BOOKMARKS_FAILED", "Could not update bookmarks in this PDF.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function applyBookmarks(
  file: File,
  bookmarks: unknown,
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  return new BookmarksProcessor().run({ files: [file], options: { bookmarks } }, onProgress);
}
