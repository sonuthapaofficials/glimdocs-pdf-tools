import { BaseLocalProcessor } from "../processor";
import { qpdfProcess } from "../qpdf-loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export type ProtectOptions = {
  userPassword?: string;
  ownerPassword?: string;
};

// AES-256 encryption via qpdf: printing allowed, everything else
// (modify, extract, annotate, forms, assemble) denied.
export class ProtectProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    const opts = (input.options ?? {}) as ProtectOptions;
    const userPw = (opts.userPassword ?? "").trim();
    if (!userPw) return this.fail("INVALID_INPUT", "Enter a password.");
    if (userPw.length > 128) return this.fail("INVALID_INPUT", "Password must be 128 characters or fewer.");
    const ownerPw = (opts.ownerPassword ?? "").trim() || userPw;

    try {
      this.report(15, "Loading encryption engine…");
      const bytes = new Uint8Array(await input.files[0].arrayBuffer());
      this.report(40, "Encrypting (AES-256)…");
      const out = await qpdfProcess(bytes, [
        "{in}", "--encrypt", userPw, ownerPw, "256",
        "--print=none", "--modify=none", "--extract=n",
        "--annotate=n", "--form=n", "--assemble=n",
        "--", "{out}",
      ]);
      if (!out || out.length === 0) return this.fail("PROTECT_FAILED", "Encryption produced no output.");
      this.report(100, "Done");
      return this.ok(new Blob([out as unknown as BlobPart], { type: "application/pdf" }), `${baseName(input.files[0].name)}_protected.pdf`, { encrypted: true });
    } catch (e) {
      return this.fail("PROTECT_FAILED", "Could not encrypt this PDF. It may already be encrypted.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function protectPdf(file: File, options: ProtectOptions, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new ProtectProcessor().run({ files: [file], options }, onProgress);
}
