import { BaseLocalProcessor } from "../processor";
import { loadPdfLib } from "../loader";
import { loadPdfJs } from "../pdfjs-loader";
import { validateFiles } from "../validation";
import { baseName } from "../download";
import type { ProcessInput, ProcessOutput, ProgressCallback } from "../types";

export const DESKEW_MAX_PAGES = 20;
export const DESKEW_MIN_DEGREES = 0.3;
const DETECT_MAX_DIM = 480;
const CORRECT_DPI = 150;
const CORRECT_JPEG_Q = 0.85;

// Straighten slanted scans, fully on-device: render each page to a bitmap,
// detect the skew angle with a shear-sweep over the horizontal projection
// profile (classic document-analysis technique, zero dependencies), then
// rotate and rebuild. Pages already straight keep their original vector
// content via copyPages; only tilted pages become images.
//
// No off-the-shelf deskew primitive exists in our on-device engines
// (page save/clean/deflate only) — so the projection-profile method below
// is implemented from scratch on canvas pixels. Output is honest about
// what it is: straightened pages, image-based where rotation was applied.

// --- Pure math on grayscale buffers (Node-testable, no DOM) ---

export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let bestLo = 128;
  let bestHi = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestLo = t;
      bestHi = t;
    } else if (between === best) {
      bestHi = t;
    }
  }
  // Midpoint of the max plateau: a strict `>` tie-break sticks at one edge
  // (0 or 254 on clean bimodal data), which would eat gray anti-aliased
  // text or admit near-white noise as ink.
  return (bestLo + bestHi) >> 1;
}

// Variance of the horizontal ink projection. Sharp text rows (deskewed)
// concentrate ink into few rows -> high variance; slanted text smears it.
export function projectionVariance(gray: Uint8Array, w: number, h: number): number {
  const rows = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    const off = y * w;
    for (let x = 0; x < w; x++) s += 255 - gray[off + x];
    rows[y] = s;
  }
  let mean = 0;
  for (let y = 0; y < h; y++) mean += rows[y];
  mean /= h;
  let v = 0;
  for (let y = 0; y < h; y++) {
    const d = rows[y] - mean;
    v += d * d;
  }
  return v / h;
}

// Shear-sweep skew estimate in degrees. Positive = text baseline rises
// toward the right (canvas coords, y down). Returns 0 when the page has
// too little (blank) or too much (full-bleed photo) ink to judge.
export function detectSkewAngle(
  gray: Uint8Array,
  w: number,
  h: number,
  maxDeg = 10,
  step = 0.5,
): number {
  const t = otsuThreshold(gray);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] <= t) {
      ys.push((i / w) | 0);
      xs.push(i % w);
    }
  }
  const coverage = xs.length / gray.length;
  if (xs.length < 200 || coverage < 0.005 || coverage > 0.6) return 0;
  // Bound cost: stride-sample huge ink sets.
  const stride = Math.max(1, Math.ceil(xs.length / 40000));
  const n = Math.ceil(xs.length / stride);
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  for (let i = 0, j = 0; i < xs.length; i += stride, j++) {
    sx[j] = xs[i];
    sy[j] = ys[i];
  }
  let bestAngle = 0;
  let bestScore = -1;
  const bins = new Float64Array(h);
  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += step) {
    const slope = Math.tan((deg * Math.PI) / 180);
    bins.fill(0);
    for (let i = 0; i < n; i++) {
      const r = Math.round(sy[i] + sx[i] * slope);
      if (r >= 0 && r < h) bins[r]++;
    }
    let mean = 0;
    for (let y = 0; y < h; y++) mean += bins[y];
    mean /= h;
    let v = 0;
    for (let y = 0; y < h; y++) {
      const d = bins[y] - mean;
      v += d * d;
    }
    if (v > bestScore) {
      bestScore = v;
      bestAngle = deg;
    }
  }
  return bestAngle;
}

// Nearest-neighbour rotation of a grayscale buffer. Angle uses the canvas
// convention: positive rotates the image clockwise as viewed. Output canvas
// is expanded so nothing is cropped; fill is white.
export function rotateGrayBuffer(
  gray: Uint8Array,
  w: number,
  h: number,
  angleDeg: number,
): { data: Uint8Array; w: number; h: number } {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const nw = Math.ceil(Math.abs(w * cos) + Math.abs(h * sin));
  const nh = Math.ceil(Math.abs(w * sin) + Math.abs(h * cos));
  const out = new Uint8Array(nw * nh).fill(255);
  const cx = w / 2;
  const cy = h / 2;
  const ncx = nw / 2;
  const ncy = nh / 2;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      // Inverse-map: dest -> src through R(-a).
      const dx = x - ncx;
      const dy = y - ncy;
      const sx = Math.round(dx * cos + dy * sin + cx);
      const sy = Math.round(-dx * sin + dy * cos + cy);
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) out[y * nw + x] = gray[sy * w + sx];
    }
  }
  return { data: out, w: nw, h: nh };
}

// --- Browser pipeline ---

function toGrayscale(data: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array((data.length / 4) | 0);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
  }
  return gray;
}

// Decide the clockwise correction angle for one detection bitmap. Tries the
// shear estimate in both directions plus "do nothing" and keeps whatever
// maximizes projection sharpness — self-correcting against any sign error.
function decideCorrection(gray: Uint8Array, w: number, h: number): number {
  const est = detectSkewAngle(gray, w, h);
  if (est === 0) return 0;
  const base = projectionVariance(gray, w, h);
  let best = 0;
  let bestScore = base;
  for (const cand of [est, -est]) {
    const r = rotateGrayBuffer(gray, w, h, cand);
    const s = projectionVariance(r.data, r.w, r.h);
    if (s > bestScore * 1.02) {
      bestScore = s;
      best = cand;
    }
  }
  return Math.abs(best) < DESKEW_MIN_DEGREES ? 0 : best;
}

export class DeskewProcessor extends BaseLocalProcessor {
  async run(input: ProcessInput, onProgress?: ProgressCallback): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;
    const err = validateFiles(input.files, { min: 1, max: 1, kind: "pdf" });
    if (err) return this.fail("INVALID_INPUT", err);
    if (typeof document === "undefined")
      return this.fail("BROWSER_ONLY", "Deskew needs a browser canvas. Open this tool in your browser.");
    try {
      this.report(4, "Loading engines…");
      const pdfLib = await loadPdfLib();
      const bytes = new Uint8Array(await input.files[0].arrayBuffer());
      const src = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const pdfjs = await loadPdfJs();
      const task = pdfjs.getDocument({ data: bytes });
      const doc = await task.promise;
      if (doc.numPages > DESKEW_MAX_PAGES) {
        await task.destroy();
        return this.fail(
          "TOO_MANY_PAGES",
          `Deskew handles up to ${DESKEW_MAX_PAGES} pages per run on the free plan. Split the file first.`,
        );
      }
      const out = await pdfLib.PDFDocument.create();
      let corrected = 0;
      try {
        for (let p = 1; p <= doc.numPages; p++) {
          if (this.isCancelled()) return this.fail("CANCELLED", "Cancelled.");
          this.report(4 + Math.round((p / doc.numPages) * 80), `Checking page ${p}/${doc.numPages}…`);
          const page = await doc.getPage(p);
          const v1 = page.getViewport({ scale: 1 });
          const dScale = DETECT_MAX_DIM / Math.max(v1.width, v1.height);
          const dv = page.getViewport({ scale: dScale });
          const dCanvas = document.createElement("canvas");
          dCanvas.width = Math.max(1, Math.ceil(dv.width));
          dCanvas.height = Math.max(1, Math.ceil(dv.height));
          await page.render({ canvas: dCanvas, viewport: dv, background: "#ffffff" }).promise;
          const dCtx = dCanvas.getContext("2d", { willReadFrequently: true });
          if (!dCtx) return this.fail("DESKEW_FAILED", `Could not read page ${p} pixels.`);
          const gray = toGrayscale(dCtx.getImageData(0, 0, dCanvas.width, dCanvas.height).data);
          const fix = decideCorrection(gray, dCanvas.width, dCanvas.height);
          if (fix === 0) {
            const [copied] = await out.copyPages(src, [p - 1]);
            out.addPage(copied);
            continue;
          }
          // Tilted: re-render at print resolution, rotate, embed as JPEG.
          this.report(4 + Math.round((p / doc.numPages) * 80), `Straightening page ${p} (${fix.toFixed(1)}°)…`);
          const scale = CORRECT_DPI / 72;
          const fv = page.getViewport({ scale });
          const fCanvas = document.createElement("canvas");
          fCanvas.width = Math.ceil(fv.width);
          fCanvas.height = Math.ceil(fv.height);
          await page.render({ canvas: fCanvas, viewport: fv, background: "#ffffff" }).promise;
          const rad = (fix * Math.PI) / 180;
          const cos = Math.abs(Math.cos(rad));
          const sin = Math.abs(Math.sin(rad));
          const rw = fCanvas.width * cos + fCanvas.height * sin;
          const rh = fCanvas.width * sin + fCanvas.height * cos;
          const rCanvas = document.createElement("canvas");
          rCanvas.width = Math.ceil(rw);
          rCanvas.height = Math.ceil(rh);
          const rCtx = rCanvas.getContext("2d");
          if (!rCtx) return this.fail("DESKEW_FAILED", `Could not rotate page ${p}.`);
          rCtx.fillStyle = "#ffffff";
          rCtx.fillRect(0, 0, rCanvas.width, rCanvas.height);
          rCtx.translate(rCanvas.width / 2, rCanvas.height / 2);
          rCtx.rotate(rad);
          rCtx.drawImage(fCanvas, -fCanvas.width / 2, -fCanvas.height / 2);
          const blob = await new Promise<Blob | null>((r) => rCanvas.toBlob(r, "image/jpeg", CORRECT_JPEG_Q));
          if (!blob) return this.fail("DESKEW_FAILED", `Could not encode page ${p}.`);
          const embedded = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          // Contain-fit on the original page size: no cropping, honest margins.
          const pw = v1.width;
          const ph = v1.height;
          const fit = Math.min(pw / rCanvas.width, ph / rCanvas.height);
          const dw = rCanvas.width * fit;
          const dh = rCanvas.height * fit;
          const newPage = out.addPage([pw, ph]);
          newPage.drawImage(embedded, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
          corrected++;
        }
      } finally {
        await task.destroy();
      }
      this.report(95, "Saving…");
      const saved = await out.save({ useObjectStreams: true });
      this.report(100, "Done");
      return this.ok(
        new Blob([new Uint8Array(saved)], { type: "application/pdf" }),
        `${baseName(input.files[0].name)}_deskewed.pdf`,
        { pages: out.getPageCount(), corrected },
      );
    } catch (e) {
      return this.fail("DESKEW_FAILED", "Could not deskew this PDF.", e instanceof Error ? e.message : undefined);
    }
  }
}

export async function deskewPdf(file: File, onProgress?: ProgressCallback): Promise<ProcessOutput> {
  return new DeskewProcessor().run({ files: [file] }, onProgress);
}
