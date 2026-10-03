// Trigger a browser download for a Blob or list of Blobs.
export function downloadBlobs(
  result: Blob | Blob[],
  filename: string | string[]
): void {
  const blobs = Array.isArray(result) ? result : [result];
  const names = Array.isArray(filename) ? filename : [filename];
  blobs.forEach((blob, i) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = names[i] ?? `output-${i + 1}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

export function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}
