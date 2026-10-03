// Copies the pdf.js worker from node_modules into public/ so all
// processing stays local (no CDN). Runs on postinstall (incl. Docker).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = join(root, "public", "workers", "pdf.worker.min.mjs");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("[glimdocs] pdf.js worker staged at public/workers/pdf.worker.min.mjs");
