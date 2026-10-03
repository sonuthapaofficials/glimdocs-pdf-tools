import { BaseLocalProcessor } from "../processor";
import { qpdfProcess } from "../qpdf-loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type UnlockOptions = {
  password?: string;
};

// Remove password restrictions with the valid password (qpdf decrypt).
export class UnlockProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const password = ((input.options as UnlockOptions | undefined)?.password ?? "").trim();
    if (!password) return this.fail("INVALID_INPUT", "Enter the file password.");

    try {
      this.report(15, "Loading decryption engine…");
      const bytes = new Uint8Array(await input.files[0].arrayBuffer());
      this.report(40, "Decrypting…");
      const out = await qpdfProcess(bytes, [`--password=${password}`, "--decrypt", "{in}", "{out}"]);
      if (!out || out.length === 0) return this.fail("UNLOCK_FAILED", "Wrong password, or this file cannot be unlocked.");
      this.report(100, "Done");
      return this.ok(new Blob([out as unknown as BlobPart], { type: "application/pdf" }), `${baseName(input.files[0].name)}_unlocked.pdf`, { unlocked: true });
    } catch (e) {
      return this.fail("UNLOCK_FAILED", "Wrong password, or this file cannot be unlocked.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function unlockPdf(file: File, options: UnlockOptions, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new UnlockProcessor().run({ files: [file], options }, onProgress);
}
