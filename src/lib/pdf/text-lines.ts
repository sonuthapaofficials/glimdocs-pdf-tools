// Shared pdf.js text-line extraction: groups text items into reading-order
// lines by Y coordinate. Used by the from-PDF converters (Word/Excel/CSV)
// and Compare so they all agree on line structure.
import { loadPdfJs } from "./pdfjs-loader";

export interface TextItem {
  str: string;
  x: number;
  y: number;
}

export async function getPageTextItems(
  data: Uint8Array | ArrayBuffer,
  pageNum: number
): Promise<TextItem[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    if (pageNum < 1 || pageNum > doc.numPages)
      throw new Error(`Page ${pageNum} out of range (1-${doc.numPages}).`);
    const page = await doc.getPage(pageNum);
    const tc = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of tc.items as unknown as {
      str?: string;
      transform?: number[];
    }[]) {
      const str = (raw.str ?? "").replace(/\s+/g, " ").trim();
      if (!str || !raw.transform) continue;
      items.push({ str, x: raw.transform[4] ?? 0, y: raw.transform[5] ?? 0 });
    }
    return items;
  } finally {
    await task.destroy();
  }
}

// Items → lines: cluster by Y (±2pt), sort top-to-bottom, join left-to-right.
export function itemsToLines(items: TextItem[], yTol = 2): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextItem[][] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - it.y) <= yTol);
    if (row) row.push(it);
    else rows.push([it]);
  }
  return rows.map((r) =>
    [...r].sort((a, b) => a.x - b.x).map((i) => i.str).join(" ")
  );
}

export async function getPageLines(
  data: Uint8Array | ArrayBuffer,
  pageNum: number
): Promise<string[]> {
  return itemsToLines(await getPageTextItems(data, pageNum));
}
