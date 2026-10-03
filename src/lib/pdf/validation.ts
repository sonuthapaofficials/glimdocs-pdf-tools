export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|bmp|tiff?|svg|heic|heif)$/i.test(file.name);
}

export function validateFiles(
  files: File[],
  opts: { min?: number; max?: number; kind: "pdf" | "image" | "mixed" }
): string | null {
  const min = opts.min ?? 1;
  const max = opts.max ?? 100;
  if (files.length < min) return `Please select at least ${min} file(s).`;
  if (files.length > max) return `Please select at most ${max} file(s).`;
  for (const f of files) {
    if (f.size <= 0) return `"${f.name}" appears to be empty.`;
    if (f.size > MAX_FILE_BYTES)
      return `"${f.name}" exceeds the 100 MB limit.`;
    if (opts.kind === "pdf" && !isPdfFile(f))
      return `"${f.name}" is not a PDF file.`;
    if (opts.kind === "image" && !isImageFile(f))
      return `"${f.name}" is not a supported image (JPG, PNG, WebP).`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// pdf-lib's StandardFonts are WinAnsi-encoded: anything outside printable
// Latin-1 throws at draw time. Sanitize user text (headers, stamps, TOC…)
// up front so a single emoji can't fail the whole job.
export function toWinAnsi(s: string): string {
  return s.replace(/[^\x20-\x7E\xA1-\xFF]/g, "?");
}
