// Copies qpdf.wasm from node_modules into public/ so AES protect/unlock
// and repair stay local (no CDN). Runs on postinstall (incl. Docker).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@neslinesli93", "qpdf-wasm", "dist", "qpdf.wasm");
const dest = join(root, "public", "qpdf.wasm");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("[glimdocs] qpdf.wasm staged at public/qpdf.wasm");
