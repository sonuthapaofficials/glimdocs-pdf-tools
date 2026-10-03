import { BaseLocalProcessor } from "../processor";
import { qpdfProcess } from "../qpdf-loader";
import { validateFiles } from "../validation";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

// Structural rebuild via qpdf: re-linearizes objects and fixes broken
// cross-reference tables/trailers. Encrypted files without a password
// cannot be rebuilt (use Unlock first).
export class RepairProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);

    try {
      this.report(15, "Loading repair engine…");
      const bytes = new Uint8Array(await input.files[0].arrayBuffer());
      this.report(40, "Rebuilding structure…");
      const out = await qpdfProcess(bytes, ["{in}", "--decrypt", "{out}"]);
      if (!out || out.length === 0) return this.fail("REPAIR_FAILED", "qpdf produced no output — this file may be beyond repair.");
      this.report(100, "Done");
      return this.ok(new Blob([out as unknown as BlobPart], { type: "application/pdf" }), `repaired-${input.files[0].name}`, { originalSize: bytes.length, newSize: out.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/password|encrypt/i.test(msg)) return this.fail("ENCRYPTED", "This file is encrypted. Unlock it first, then repair.", msg);
      return this.fail("REPAIR_FAILED", "Could not repair this PDF. It may be encrypted or beyond repair.", msg || undefined);
    }
  }
}

export async function repairPdf(file: File, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new RepairProcessor().run({ files: [file] }, onProgress);
}
