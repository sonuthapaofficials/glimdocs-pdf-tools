import { BaseLocalProcessor } from "../processor";
import { getPageLines } from "../text-lines";
import { loadPdfJs } from "../pdfjs-loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

function lcsLen(a: string[], b: string[]): number {
  // Capped DP: compare at most 300 lines per page (sampled evenly).
  const slim = (xs: string[]) => (xs.length <= 300 ? xs : xs.filter((_, i) => i % Math.ceil(xs.length / 300) === 0));
  const A = slim(a);
  const B = slim(b);
  if (A.length === 0 || B.length === 0) return 0;
  let prev = new Uint16Array(B.length + 1);
  let cur = new Uint16Array(B.length + 1);
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[B.length];
}

function diffLines(a: string[], b: string[], max = 40): string[] {
  // Simple prefix/suffix trim + list leftovers as -/+ (good enough for v1).
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length - 1;
  let eb = b.length - 1;
  while (ea >= s && eb >= s && a[ea] === b[eb]) { ea--; eb--; }
  const out: string[] = [];
  for (let i = s; i <= ea && out.length < max; i++) out.push(`- ${a[i].slice(0, 160)}`);
  for (let i = s; i <= eb && out.length < max * 2; i++) out.push(`+ ${b[i].slice(0, 160)}`);
  if (ea - s + 1 + (eb - s + 1) > max * 2) out.push(`… (${ea - s + 1 + (eb - s + 1) - out.length} more differing lines)`);
  return out;
}

// Text-based PDF comparison: per-page similarity % plus a line diff.
// Reports .md. (Pixel-perfect visual diff ships in a later tier.)
export class CompareProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 2, max: 2, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", "Add exactly two PDFs: original first, revised second.");
    const [fa, fb] = input.files;

    try {
      this.report(10, "Reading both PDFs…");
      const ba = new Uint8Array(await fa.arrayBuffer());
      const bb = new Uint8Array(await fb.arrayBuffer());
      const pdfjs = await loadPdfJs();
      const ta = pdfjs.getDocument({ data: ba.slice() });
      const tb = pdfjs.getDocument({ data: bb.slice() });
      const da = await ta.promise;
      const db = await tb.promise;
      try {
        const pairs = Math.min(da.numPages, db.numPages);
        if (pairs === 0) return this.fail("INVALID_INPUT", "One of the files has no pages.");
        const md: string[] = [
          `# Compare: ${fa.name} vs ${fb.name}`,
          ``,
          `- Original: ${da.numPages} page(s) — Revised: ${db.numPages} page(s)`,
          da.numPages !== db.numPages ? `- Note: page counts differ; comparing the first ${pairs} page(s).` : ``,
          ``,
        ];
        let simSum = 0;
        for (let p = 1; p <= pairs; p++) {
          if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
          const la = await getPageLines(ba.slice(), p);
          const lb = await getPageLines(bb.slice(), p);
          const lcs = lcsLen(la, lb);
          const sim = la.length + lb.length === 0 ? 100 : Math.round((2 * lcs * 100) / (la.length + lb.length));
          simSum += sim;
          md.push(`## Page ${p} — ${sim}% similar`, ``);
          if (sim < 100) {
            const d = diffLines(la, lb);
            md.push("```diff", ...d, "```", ``);
          } else md.push(`Identical text.`, ``);
          this.report(10 + Math.round((p / pairs) * 80), `Comparing page ${p}/${pairs}…`);
        }
        const avg = Math.round(simSum / pairs);
        md.unshift(``, `**Overall text similarity: ${avg}%**`);
        this.report(100, "Done");
        return this.ok(
          new Blob([md.join("\n")], { type: "text/markdown" }),
          `${baseName(fa.name)}_vs_${baseName(fb.name)}.md`,
          { pages: pairs, similarity: avg }
        );
      } finally {
        await ta.destroy();
        await tb.destroy();
      }
    } catch (e) {
      return this.fail("COMPARE_FAILED", "Could not compare these PDFs.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function comparePdfs(a: File, b: File, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new CompareProcessor().run({ files: [a, b] }, onProgress);
}
