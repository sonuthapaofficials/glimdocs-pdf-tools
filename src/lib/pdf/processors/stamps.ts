import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { validateFiles, toWinAnsi } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type StampPreset = "APPROVED" | "CONFIDENTIAL" | "DRAFT" | "REVIEWED" | "VOID" | "CUSTOM";

const PRESET_COLORS: Record<Exclude<StampPreset, "CUSTOM">, [number, number, number]> = {
  APPROVED: [0, 0.5, 0],
  CONFIDENTIAL: [0.75, 0, 0],
  DRAFT: [0.4, 0.4, 0.4],
  REVIEWED: [0, 0.25, 0.65],
  VOID: [0.75, 0, 0],
};

export type StampOptions = {
  preset?: StampPreset;
  customText?: string;
};

// Diagonal rubber-stamp overlay (boxed, semi-transparent) on every page.
export class StampProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const opts = (input.options ?? {}) as StampOptions;
    const preset = opts.preset ?? "DRAFT";
    const text = toWinAnsi(
      (preset === "CUSTOM" ? opts.customText ?? "" : preset).toUpperCase().slice(0, 40)
    );
    if (!text) return this.fail("INVALID_INPUT", "Enter custom stamp text.");
    const rgb = preset === "CUSTOM" ? [0.35, 0.2, 0.6] as [number, number, number] : PRESET_COLORS[preset];

    try {
      this.report(10, "Loading PDF engine…");
      const pdfLib = await loadPdfLib();
      const bytes = await input.files[0].arrayBuffer();
      let doc;
      try {
        doc = await pdfLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (e) {
        return this.fail("LOAD_FAILED", "Could not read this PDF. It may be encrypted or corrupted.", e instanceof Error ? e.message : undefined);
      }
      const font = await doc.embedFont(pdfLib.StandardFonts.HelveticaBold);
      const color = pdfLib.rgb(rgb[0], rgb[1], rgb[2]);
      const pages = doc.getPages();
      for (let i = 0; i < pages.length; i++) {
        if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
        const page = pages[i];
        const { width, height } = page.getSize();
        const size = Math.min(64, Math.max(28, width / 10));
        const tw = font.widthOfTextAtSize(text, size);
        const cx = width / 2;
        const cy = height / 2;
        // Box sized to the rotated text bounds (conservative padding).
        const pad = 14;
        page.drawRectangle({
          x: cx - tw / 2 - pad, y: cy - size / 2 - pad,
          width: tw + pad * 2, height: size + pad * 2,
          borderColor: color, borderWidth: 3, opacity: 0.35,
          rotate: pdfLib.degrees(-30),
        });
        page.drawText(text, {
          x: cx - tw / 2, y: cy - size / 3,
          size, font, color, opacity: 0.35,
          rotate: pdfLib.degrees(-30),
        });
        this.report(10 + Math.round(((i + 1) / pages.length) * 80), `Stamping ${i + 1}/${pages.length}…`);
      }
      this.report(95, "Saving…");
      const saved = await doc.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(new Blob([new Uint8Array(saved)], { type: "application/pdf" }), `${baseName(input.files[0].name)}_stamped.pdf`, { pageCount: pages.length, stamp: text });
    } catch (e) {
      return this.fail("STAMP_FAILED", "Could not apply the stamp.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function addStamp(file: File, options: StampOptions, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new StampProcessor().run({ files: [file], options }, onProgress);
}
