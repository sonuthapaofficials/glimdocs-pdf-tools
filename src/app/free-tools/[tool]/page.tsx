"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { COMING_SOON, FREE_QUEUE_LIMIT, getToolSpec } from "../../../lib/pdf/tools";
import { downloadBlobs } from "../../../lib/pdf/download";
import { formatBytes } from "../../../lib/pdf/validation";
import type {
  PageRange,
  ProcessOutput,
  ProgressCallback,
} from "../../../lib/pdf/types";
import type { ImageFormat } from "../../../lib/pdf/processors/pdf-to-image";
import type { NumberPosition } from "../../../lib/pdf/processors/page-numbers";
import type { BatesPosition } from "../../../lib/pdf/processors/bates";
import type { StampPreset } from "../../../lib/pdf/processors/stamps";
import type { SignPosition } from "../../../lib/pdf/processors/sign";
import type { FormFieldInfo } from "../../../lib/pdf/processors/form-fill";
import type { BookmarkNode } from "../../../lib/pdf/processors/bookmarks";
import type { PageTarget, PageOrientation } from "../../../lib/pdf/processors/page-size";

const TOOL_DESCRIPTIONS: Record<string, string> = {  "merge-pdf": "Combine multiple PDF files into a single document with custom ordering.",
  "compress-pdf": "Reduce file size while preserving visual quality and layout integrity.",
  "ocr-pdf": "Extract text from scanned documents using optical character recognition.",
  "pdf-to-excel": "Convert PDF tables into editable Excel spreadsheets.",
  "sign-pdf": "Stamp a visual signature image or typed name onto pages. Runs fully in your browser.",
  "edit-bookmarks": "Read, reorder, rename, and rebuild hierarchical bookmark outlines.",
  "table-of-contents": "Auto-generate hyperlinked index pages.",
  "bates-numbering": "Legal litigation discovery numbering system.",
  "header-footer": "Add multi-line headers, footers, and metadata.",
  "add-stamps": "Apply approval, confidential, or void stamps.",
  "pdf-form-filler": "Fill interactive AcroForm and XFA fields.",
  "svg-to-pdf": "Convert vector SVG graphics to PDF.",
  "word-to-pdf": "Convert DOCX paragraphs, headings, and tables into a clean PDF.",
  "excel-to-pdf": "Render XLSX worksheets as bordered PDF tables.",
  "powerpoint-to-pdf": "Convert presentation slides to PDF pages.",
  "text-to-pdf": "Convert plain text with custom typography.",
  "markdown-to-pdf": "Convert Markdown with syntax highlighting.",
  "csv-to-pdf": "Convert CSV data to formatted reports.",
  "epub-to-pdf": "Convert e-books to fixed-layout PDF.",
  "pdf-to-word": "Extract content to editable DOCX format.",
  "extract-images": "Isolate embedded images from PDF documents.",
  "pdf-to-csv": "Extract table data to CSV format.",
  "duplicate-organize": "Clone and reorder pages with drag-and-drop.",
  "compare-pdfs": "Visual diff and text comparison analyzer.",
  "pdf-to-pdfa": "Convert to ISO 19005 long-term archive format.",
  "fix-page-size": "Standardize irregular pages to A4 or Letter.",
  "repair-pdf": "Rebuild damaged XREF tables and structures.",
  "rasterize-pdf": "Flatten all layers into bitmap images.",
  "deskew-pdf": "Auto-correct slanted scanned page angles.",
  "protect-pdf": "Apply AES-256 password encryption.",
  "sanitize-pdf": "Remove hidden scripts, links, and forms.",
  "unlock-pdf": "Remove restrictions with valid password.",
  "flatten-pdf": "Merge annotations and form fields into page.",
  "remove-metadata": "Strip author, GPS, and hidden metadata.",
  "digital-signature-pdf": "PKCS#7 and PAdES certified signing.",
};

function parseRangePairs(raw: string): PageRange[] | null {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: PageRange[] = [];
  for (const part of parts) {
    if (part.includes("-")) {
      const [aStr, bStr] = part.split("-");
      const a = parseInt((aStr ?? "").trim(), 10);
      const b = parseInt((bStr ?? "").trim(), 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a || b - a > 5000) return null;
      out.push({ start: a, end: b });
    } else {
      const n = parseInt(part, 10);
      if (!Number.isFinite(n) || n < 1 || n > 10000) return null;
      out.push({ start: n, end: n });
    }
  }
  return out;
}

function expandPairs(pairs: PageRange[]): number[] {
  const pages: number[] = [];
  for (const r of pairs) {
    for (let p = r.start; p <= r.end && pages.length < 10000; p++) pages.push(p);
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}

// Order-spec variant for Duplicate & Organize: repeats are meaningful
// ("1-3, 1" clones page 1 at the end), so no dedupe/sort.
function expandOrder(pairs: PageRange[]): number[] {
  const pages: number[] = [];
  for (const r of pairs) {
    for (let p = r.start; p <= r.end && pages.length < 2000; p++) pages.push(p);
  }
  return pages;
}

// Bookmark editor IDs: module-scope counter (no Date.now/Math.random in
// render scope — react-hooks/purity forbids impure calls in components).
let bmUiSeq = 0;

export default function ToolPage() {
  const params = useParams();
  const toolSlug = (params.tool as string) || "";
  const spec = getToolSpec(toolSlug);
  const toolName = (spec?.title ?? toolSlug)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const toolDesc =
    spec?.description ??
    TOOL_DESCRIPTIONS[toolSlug] ??
    "Process your documents securely in-browser with zero uploads.";

  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [rangeInput, setRangeInput] = useState("1-3");
  const [pagesInput, setPagesInput] = useState("");
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [imgQuality, setImgQuality] = useState<1 | 2 | 3>(2);
  const [watermarkText, setWatermarkText] = useState("DRAFT");
  const [watermarkOpacity, setWatermarkOpacity] = useState(15);
  const [numStart, setNumStart] = useState("1");
  const [numPos, setNumPos] = useState<NumberPosition>("bottom-center");
  const [cropMargin, setCropMargin] = useState("36");
  // Tier 3+ options.
  const [batesPrefix, setBatesPrefix] = useState("GLIM-");
  const [batesStart, setBatesStart] = useState("1");
  const [batesPos, setBatesPos] = useState<BatesPosition>("bottom-right");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("Page {p} of {n}");
  const [stampPreset, setStampPreset] = useState<StampPreset>("DRAFT");
  const [stampText, setStampText] = useState("");
  const [tocTitle, setTocTitle] = useState("Table of Contents");
  const [tocEntriesInput, setTocEntriesInput] = useState("Introduction | 1\nResults | 3");
  const [signMode, setSignMode] = useState<"image" | "text">("text");
  const [signText, setSignText] = useState("");
  const [signImage, setSignImage] = useState<File | null>(null);
  const [signPos, setSignPos] = useState<SignPosition>("bottom-right");
  const [signPagesInput, setSignPagesInput] = useState("");
  const [formFields, setFormFields] = useState<FormFieldInfo[] | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [bmTree, setBmTree] = useState<BookmarkNode[] | null>(null);
  const [bmNewTitle, setBmNewTitle] = useState("");
  const [bmNewPage, setBmNewPage] = useState("1");
  const [textTitle, setTextTitle] = useState("");
  const [textSize, setTextSize] = useState("11");
  const [csvHeader, setCsvHeader] = useState(true);
  const [csvLandscape, setCsvLandscape] = useState(false);
  const [dupOrderInput, setDupOrderInput] = useState("1-3, 1");
  const [pageSizeTarget, setPageSizeTarget] = useState<PageTarget>("A4");
  const [pageSizeOrientation, setPageSizeOrientation] = useState<PageOrientation>("auto");
  const [protectPw, setProtectPw] = useState("");
  const [protectPw2, setProtectPw2] = useState("");
  const [unlockPw, setUnlockPw] = useState("");
  const [sanMeta, setSanMeta] = useState(true);
  const [sanJs, setSanJs] = useState(true);
  const [sanAnnots, setSanAnnots] = useState(false);
  const [sanForms, setSanForms] = useState(false);
  const [loadingEngine, setLoadingEngine] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ blob: Blob | Blob[]; names: string | string[]; summary?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const signImageRef = useRef<HTMLInputElement>(null);
  const isSoon = COMING_SOON.has(toolSlug);

  // Form filler: discover fields once a PDF is selected so the UI can
  // render one input per field. Reset is a render-time adjustment (not an
  // effect) to satisfy the no-sync-setState-in-effect rule.
  const formKey = spec?.kind === "form-fill" && files.length > 0 ? `${files[0].name}:${files[0].size}` : "";
  const [lastFormKey, setLastFormKey] = useState(formKey);
  if (formKey !== lastFormKey) {
    setLastFormKey(formKey);
    setFormFields(null);
    setFormValues({});
  }
  useEffect(() => {
    if (spec?.kind !== "form-fill" || files.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await import("../../../lib/pdf/processors/form-fill");
        const fields = await m.listFormFields(files[0]);
        if (cancelled) return;
        setFormFields(fields);
        setFormValues(
          Object.fromEntries(
            fields.map((fld) => [
              fld.name,
              fld.type === "checkbox" ? fld.value === true : String(fld.value ?? ""),
            ])
          )
        );
      } catch {
        if (!cancelled) setFormFields([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spec?.kind, files]);

  // Bookmarks: load the existing outline once a PDF is selected so the
  // tree editor below has something to show. Same reset pattern as forms.
  const bmKey = spec?.kind === "bookmarks" && files.length > 0 ? `${files[0].name}:${files[0].size}` : "";
  const [lastBmKey, setLastBmKey] = useState(bmKey);
  if (bmKey !== lastBmKey) {
    setLastBmKey(bmKey);
    setBmTree(null);
  }
  useEffect(() => {
    if (spec?.kind !== "bookmarks" || files.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const m = await import("../../../lib/pdf/processors/bookmarks");
        const tree = await m.readBookmarks(files[0]);
        if (!cancelled) setBmTree(tree);
      } catch {
        if (!cancelled) setBmTree([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spec?.kind, files]);

  // Bookmark tree helpers: pure recursive transforms over BookmarkNode[].
  // ID counter lives at module scope: Date.now()/Math.random() are impure
  // and forbidden anywhere in render scope (react-hooks/purity).
  const bmNewId = () => `bm-ui-${++bmUiSeq}`;
  const bmMutate = (fn: (nodes: BookmarkNode[]) => BookmarkNode[]) =>
    setBmTree((t) => (t ? fn(t) : t));
  const bmMap = (nodes: BookmarkNode[], id: string, fn: (n: BookmarkNode) => BookmarkNode): BookmarkNode[] =>
    nodes.map((n) => (n.id === id ? fn(n) : { ...n, children: bmMap(n.children, id, fn) }));
  const bmRemove = (nodes: BookmarkNode[], id: string): BookmarkNode[] =>
    nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: bmRemove(n.children, id) }));
  const bmMove = (nodes: BookmarkNode[], id: string, dir: -1 | 1): BookmarkNode[] => {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx >= 0) {
      const j = idx + dir;
      if (j < 0 || j >= nodes.length) return nodes;
      const copy = [...nodes];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    }
    return nodes.map((n) => ({ ...n, children: bmMove(n.children, id, dir) }));
  };
  const bmIndent = (nodes: BookmarkNode[], id: string): BookmarkNode[] => {
    const idx = nodes.findIndex((n) => n.id === id);
    if (idx > 0) {
      const copy = [...nodes];
      const [moved] = copy.splice(idx, 1);
      const prev = copy[idx - 1];
      copy[idx - 1] = { ...prev, children: [...prev.children, moved] };
      return copy;
    }
    return nodes.map((n) => ({ ...n, children: bmIndent(n.children, id) }));
  };
  const bmOutdent = (nodes: BookmarkNode[], id: string): BookmarkNode[] => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const idx = n.children.findIndex((c) => c.id === id);
      if (idx >= 0) {
        const copy = [...nodes];
        const kids = [...n.children];
        const [moved] = kids.splice(idx, 1);
        copy[i] = { ...n, children: kids };
        copy.splice(i + 1, 0, moved);
        return copy;
      }
    }
    return nodes.map((n) => ({ ...n, children: bmOutdent(n.children, id) }));
  };
  const bmAddTop = () => {
    const title = bmNewTitle.trim().slice(0, 200) || "New bookmark";
    const page = Math.max(1, Math.floor(Number(bmNewPage) || 1));
    setBmTree((t) => [...(t ?? []), { id: bmNewId(), title, page, children: [] }]);
    setBmNewTitle("");
  };
  const bmAddChild = (id: string) =>
    bmMutate((nodes) =>
      bmMap(nodes, id, (n) => ({
        ...n,
        children: [...n.children, { id: bmNewId(), title: "New bookmark", page: n.page, children: [] }],
      }))
    );
  const renderBmNodes = (nodes: BookmarkNode[], depth: number): ReactNode[] =>
    nodes.map((n) => (
      <div key={n.id} style={{ marginLeft: depth * 16 }}>
        <div className="flex items-center gap-1 py-0.5">
          <input
            value={n.title}
            onChange={(e) => bmMutate((t) => bmMap(t, n.id, (x) => ({ ...x, title: e.target.value.slice(0, 200) })))}
            aria-label="Bookmark title"
            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg bg-surface-container-high text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            type="number"
            min={1}
            value={n.page}
            onChange={(e) => bmMutate((t) => bmMap(t, n.id, (x) => ({ ...x, page: Math.max(1, Math.floor(Number(e.target.value) || 1)) })))}
            title="Target page"
            className="w-14 shrink-0 text-xs px-2 py-1.5 rounded-lg bg-surface-container-high text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button title="Move up" onClick={() => bmMutate((t) => bmMove(t, n.id, -1))} className="px-1.5 py-1 rounded-md text-[11px] font-bold bg-surface-container-high text-on-surface-variant hover:text-on-surface">↑</button>
          <button title="Move down" onClick={() => bmMutate((t) => bmMove(t, n.id, 1))} className="px-1.5 py-1 rounded-md text-[11px] font-bold bg-surface-container-high text-on-surface-variant hover:text-on-surface">↓</button>
          <button title="Nest under previous item" onClick={() => bmMutate((t) => bmIndent(t, n.id))} className="px-1.5 py-1 rounded-md text-[11px] font-bold bg-surface-container-high text-on-surface-variant hover:text-on-surface">→</button>
          <button title="Move out one level" onClick={() => bmMutate((t) => bmOutdent(t, n.id))} className="px-1.5 py-1 rounded-md text-[11px] font-bold bg-surface-container-high text-on-surface-variant hover:text-on-surface">←</button>
          <button title="Add sub-bookmark" onClick={() => bmAddChild(n.id)} className="px-1.5 py-1 rounded-md text-[11px] font-bold bg-surface-container-high text-on-surface-variant hover:text-on-surface">+</button>
          <button title="Delete" onClick={() => bmMutate((t) => bmRemove(t, n.id))} className="px-1.5 py-1 rounded-md text-[11px] font-bold bg-surface-container-high text-on-surface-variant hover:text-red-500">×</button>
        </div>
        {renderBmNodes(n.children, depth + 1)}
      </div>
    ));

  const acceptAttr = spec?.acceptMime ?? ".pdf,application/pdf";  const isQueue = spec?.multiple ?? false;
  const queueLimit = FREE_QUEUE_LIMIT[toolSlug] ?? 1;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const addFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming).slice(0, 1);
    if (list.length === 0) return;
    setResult(null);
    setError("");
    setFiles((prev) => {
      if (!isQueue) return [list[0]];
      if (prev.length >= queueLimit) {
        setError(`Free plan: up to ${queueLimit} files. Larger batches are a premium feature.`);
        return prev;
      }
      return [...prev, ...list].slice(0, queueLimit);
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setResult(null);
  };

  const moveFile = (idx: number, dir: -1 | 1) => {
    setFiles((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const clearAll = () => {
    setFiles([]);
    setResult(null);
    setError("");
    setProgress(0);
    setStatus("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onProgress = (p: number, msg?: string) => {
    setProgress(Math.round(p));
    if (msg) setStatus(msg);
  };

  // Lazy dispatcher: each processor (and pdf.js) is a separate chunk
  // fetched only when its tool actually runs. Nothing loads upfront.
  const runTool = async (
    kind: string,
    onP: ProgressCallback
  ): Promise<ProcessOutput> => {
    switch (kind) {
      case "merge": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/merge");
          return await m.mergePdfs(files, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "split": {
        const pairs = parseRangePairs(rangeInput);
        if (!pairs) throw new Error('Invalid ranges. Use a format like "1-3, 5, 7-9".');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/split");
          return await m.splitPdf(files[0], pairs, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "images-to-pdf": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/image-to-pdf");
          return await m.imagesToPdf(files, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "rotate": {
        const pages = pagesInput.trim() ? parseRangePairs(pagesInput) : [];
        if (pagesInput.trim() && !pages)
          throw new Error('Invalid pages. Use "1-3, 5" or leave empty for all pages.');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/rotate");
          return await m.rotatePdf(files[0], angle, pages ? expandPairs(pages) : [], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "delete-pages": {
        const pairs = parseRangePairs(pagesInput);
        if (!pairs) throw new Error('Enter pages to delete, e.g. "2, 5-7".');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/delete-pages");
          return await m.deletePages(files[0], expandPairs(pairs), onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "extract-pages": {
        const pairs = parseRangePairs(pagesInput || rangeInput);
        if (!pairs) throw new Error('Enter pages to keep, e.g. "1-3, 8".');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/extract-pages");
          return await m.extractPages(files[0], expandPairs(pairs), onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "pdf-to-image": {
        const format: ImageFormat =
          toolSlug === "pdf-to-jpg" ? "jpg" : toolSlug === "pdf-to-webp" ? "webp" : "png";
        const pageSel = pagesInput.trim() ? parseRangePairs(pagesInput) : [];
        if (pagesInput.trim() && !pageSel)
          throw new Error('Invalid pages. Use "1-3, 5" or leave empty for all pages.');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/pdf-to-image");
          return await m.pdfToImages(
            files[0],
            {
              format,
              scale: imgQuality,
              quality: 0.92,
              pages: pageSel ? expandPairs(pageSel) : [],
            },
            onP
          );
        } finally {
          setLoadingEngine(false);
        }
      }
      case "pdf-to-text": {
        const pageSel = pagesInput.trim() ? parseRangePairs(pagesInput) : [];
        if (pagesInput.trim() && !pageSel)
          throw new Error('Invalid pages. Use "1-3, 5" or leave empty for all pages.');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/pdf-to-text");
          return await m.pdfToText(
            files[0],
            {
              pages: pageSel ? expandPairs(pageSel) : [],
              asJson: toolSlug === "pdf-to-json",
              asMarkdown: toolSlug === "pdf-to-markdown",
            },
            onP
          );
        } finally {
          setLoadingEngine(false);
        }
      }
      case "watermark": {
        if (!watermarkText.trim()) throw new Error("Enter watermark text.");
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/watermark");
          return await m.addWatermark(
            files[0],
            { text: watermarkText.trim(), opacity: watermarkOpacity / 100 },
            onP
          );
        } finally {
          setLoadingEngine(false);
        }
      }
      case "page-numbers": {
        const start = Math.max(1, Math.floor(Number(numStart) || 1));
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/page-numbers");
          return await m.addPageNumbers(files[0], { start, position: numPos }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "crop": {
        const margin = Number(cropMargin);
        if (!Number.isFinite(margin) || margin < 0 || margin > 200)
          throw new Error("Margin must be between 0 and 200 pt (72 pt = 1 inch).");
        const pageSel = pagesInput.trim() ? parseRangePairs(pagesInput) : [];
        if (pagesInput.trim() && !pageSel)
          throw new Error('Invalid pages. Use "1-3, 5" or leave empty for all pages.');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/crop");
          return await m.cropPdf(
            files[0],
            { margin, pages: pageSel ? expandPairs(pageSel) : [] },
            onP
          );
        } finally {
          setLoadingEngine(false);
        }
      }
      case "compress": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/compress");
          return await m.compressPdf(files[0], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "bates": {
        const start = Math.max(1, Math.floor(Number(batesStart) || 1));
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/bates");
          return await m.addBatesNumbering(files[0], { prefix: batesPrefix.trim() || "GLIM-", start, digits: 6, position: batesPos }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "header-footer": {
        if (!headerText.trim() && !footerText.trim()) throw new Error("Enter a header, a footer, or both.");
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/header-footer");
          return await m.addHeaderFooter(files[0], { header: headerText.trim(), footer: footerText.trim() }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "stamp": {
        if (stampPreset === "CUSTOM" && !stampText.trim()) throw new Error("Enter custom stamp text.");
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/stamps");
          return await m.addStamp(files[0], { preset: stampPreset, customText: stampText.trim() }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "toc": {
        const entries: { title: string; page: number }[] = [];
        for (const line of tocEntriesInput.split("\n")) {
          const t = line.trim();
          if (!t) continue;
          const mline = t.match(/^(.+)\|\s*(\d+)\s*$/);
          if (!mline) throw new Error(`Bad TOC line (use "Title | page"): ${t.slice(0, 40)}`);
          entries.push({ title: mline[1].trim(), page: parseInt(mline[2], 10) });
        }
        if (!entries.length) throw new Error('Add at least one TOC entry ("Title | page").');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/toc");
          return await m.addTableOfContents(files[0], { title: tocTitle.trim() || "Table of Contents", entries }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "sign": {
        const sel = signPagesInput.trim() ? parseRangePairs(signPagesInput) : [];
        if (signPagesInput.trim() && !sel) throw new Error('Invalid pages. Use "2, 5" or leave empty for the last page.');
        let imageBytes: Uint8Array | undefined;
        let imageMime: string | undefined;
        if (signMode === "image") {
          if (!signImage) throw new Error("Upload a signature image (PNG/JPG).");
          imageBytes = new Uint8Array(await signImage.arrayBuffer());
          imageMime = signImage.type;
        } else if (!signText.trim()) throw new Error("Type your name for the signature.");
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/sign");
          return await m.signPdfVisual(files[0], {
            imageBytes, imageMime,
            text: signMode === "text" ? signText.trim() : undefined,
            position: signPos,
            pages: sel ? expandPairs(sel) : [],
          }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "form-fill": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/form-fill");
          return await m.fillPdfForm(files[0], formValues, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "bookmarks": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/bookmarks");
          const tree = bmTree ?? (await m.readBookmarks(files[0]));
          return await m.applyBookmarks(files[0], tree, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "word-to-pdf": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/word-to-pdf");
          return await m.wordToPdf(files[0], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "excel-to-pdf": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/excel-to-pdf");
          return await m.excelToPdf(files[0], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "svg-to-pdf": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/svg-to-pdf");
          return await m.svgToPdf(files[0], { scale: imgQuality }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "text-to-pdf": {
        const size = Math.min(18, Math.max(8, Math.floor(Number(textSize) || 11)));
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/text-to-pdf");
          return await m.textToPdf(files[0], { title: textTitle.trim(), fontSize: size }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "markdown-to-pdf": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/markdown-to-pdf");
          return await m.markdownToPdf(files[0], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "csv-to-pdf": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/csv-to-pdf");
          return await m.csvToPdf(files[0], { headerRow: csvHeader, landscape: csvLandscape }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "pdf-to-word": {
        const pageSel = pagesInput.trim() ? parseRangePairs(pagesInput) : [];
        if (pagesInput.trim() && !pageSel) throw new Error('Invalid pages. Use "1-3, 5" or leave empty for all pages.');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/pdf-to-word");
          return await m.pdfToWord(files[0], { pages: pageSel ? expandPairs(pageSel) : [] }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "pdf-to-excel": {
        const pageSel = pagesInput.trim() ? parseRangePairs(pagesInput) : [];
        if (pagesInput.trim() && !pageSel) throw new Error('Invalid pages. Use "1-3, 5" or leave empty for all pages.');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/pdf-to-excel");
          return await m.pdfToExcel(files[0], { pages: pageSel ? expandPairs(pageSel) : [] }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "extract-images": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/extract-images");
          return await m.extractImages(files[0], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "pdf-to-csv": {
        const pageSel = pagesInput.trim() ? parseRangePairs(pagesInput) : [];
        if (pagesInput.trim() && !pageSel) throw new Error('Invalid pages. Use "1-3, 5" or leave empty for all pages.');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/pdf-to-csv");
          return await m.pdfToCsv(files[0], { pages: pageSel ? expandPairs(pageSel) : [] }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "duplicate": {
        const pairs = parseRangePairs(dupOrderInput);
        if (!pairs) throw new Error('Enter a page order, e.g. "3, 1-2, 1". Repeats duplicate the page.');
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/duplicate");
          return await m.duplicateOrganize(files[0], { order: expandOrder(pairs) }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "compare": {
        if (files.length !== 2) throw new Error("Add exactly two PDFs: original first, revised second.");
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/compare");
          return await m.comparePdfs(files[0], files[1], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "page-size": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/page-size");
          return await m.fixPageSize(files[0], { target: pageSizeTarget, orientation: pageSizeOrientation }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "repair": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/repair");
          return await m.repairPdf(files[0], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "rasterize": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/rasterize");
          return await m.rasterizePdf(files[0], { scale: imgQuality }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "deskew": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/deskew");
          return await m.deskewPdf(files[0], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "protect": {
        if (!protectPw) throw new Error("Enter a password.");
        if (protectPw !== protectPw2) throw new Error("Passwords do not match.");
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/protect");
          return await m.protectPdf(files[0], { userPassword: protectPw }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "unlock": {
        if (!unlockPw) throw new Error("Enter the file password.");
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/unlock");
          return await m.unlockPdf(files[0], { password: unlockPw }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "sanitize": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/sanitize");
          return await m.sanitizePdf(files[0], { metadata: sanMeta, javascript: sanJs, annotations: sanAnnots, forms: sanForms }, onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "flatten": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/flatten");
          return await m.flattenPdf(files[0], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      case "remove-metadata": {
        setLoadingEngine(true);
        try {
          const m = await import("../../../lib/pdf/processors/metadata");
          return await m.removeMetadata(files[0], onP);
        } finally {
          setLoadingEngine(false);
        }
      }
      default:
        throw new Error("This tool is not enabled yet.");
    }
  };

  const handleProcess = async () => {
    if (!spec || files.length === 0 || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setProgress(2);
    setStatus("Loading engine…");
    try {
      const out = await runTool(spec.kind, onProgress);
      if (!out.success) {
        setError(out.error.details ? `${out.error.message} (${out.error.details})` : out.error.message);
        setStatus("");
      } else {
        const meta = (out as { metadata?: Record<string, unknown> }).metadata;
        let summary: string | undefined;
        if (
          meta &&
          typeof meta.originalSize === "number" &&
          typeof meta.newSize === "number"
        ) {
          const saved = Math.max(0, meta.originalSize - meta.newSize);
          const pct =
            meta.originalSize > 0 ? Math.round((saved / meta.originalSize) * 100) : 0;
          summary =
            saved > 0
              ? `${formatBytes(meta.originalSize)} → ${formatBytes(meta.newSize)} (saved ${pct}%)`
              : `${formatBytes(meta.originalSize)} → ${formatBytes(meta.newSize)} (already optimal; metadata stripped)`;
        }
        setResult({ blob: out.result, names: out.filename ?? "output.pdf", summary });
        setStatus("Done. Your file never left this device.");
        setProgress(100);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (result) downloadBlobs(result.blob, result.names);
  };

  const showRanges = spec?.kind === "split";
  const showKeepPages = spec?.kind === "extract-pages";
  const showDeletePages = spec?.kind === "delete-pages";
  const showRotate = spec?.kind === "rotate";
  const showImgOpts = spec?.kind === "pdf-to-image";
  const showTextPages = spec?.kind === "pdf-to-text";
  const showWatermark = spec?.kind === "watermark";
  const showNumbering = spec?.kind === "page-numbers";
  const showCrop = spec?.kind === "crop";
  const showCompress = spec?.kind === "compress";
  const showBates = spec?.kind === "bates";
  const showHeaderFooter = spec?.kind === "header-footer";
  const showStamp = spec?.kind === "stamp";
  const showToc = spec?.kind === "toc";
  const showSign = spec?.kind === "sign";
  const showFormFill = spec?.kind === "form-fill";
  const showBookmarks = spec?.kind === "bookmarks";
  const showSvg = spec?.kind === "svg-to-pdf";
  const showText = spec?.kind === "text-to-pdf";
  const showCsv = spec?.kind === "csv-to-pdf";
  const showConverterPages = spec?.kind === "pdf-to-word" || spec?.kind === "pdf-to-excel" || spec?.kind === "pdf-to-csv";
  const showDuplicate = spec?.kind === "duplicate";
  const showPageSize = spec?.kind === "page-size";
  const showProtect = spec?.kind === "protect";
  const showUnlock = spec?.kind === "unlock";
  const showSanitize = spec?.kind === "sanitize";

  const uploadNoun =
    spec?.kind === "images-to-pdf" ? "image"
    : spec?.kind === "svg-to-pdf" ? "SVG"
    : spec?.kind === "text-to-pdf" ? "text file"
    : spec?.kind === "markdown-to-pdf" ? "Markdown file"
    : spec?.kind === "csv-to-pdf" ? "CSV file"
    : spec?.kind === "word-to-pdf" ? "Word file"
    : spec?.kind === "excel-to-pdf" ? "Excel file"
    : spec?.kind === "compare" ? "PDF (add both files, original first)"
    : spec?.kind === "pdf-to-image" || spec?.kind === "pdf-to-text" || spec?.kind === "pdf-to-word" || spec?.kind === "pdf-to-excel" || spec?.kind === "extract-images" || spec?.kind === "pdf-to-csv" ? "PDF"
    : "file";
  const uploadHint =
    spec?.kind === "images-to-pdf" ? "JPG / PNG / WebP" : spec?.kind === "svg-to-pdf" ? "SVG up to 20 MB"
    : spec?.kind === "text-to-pdf" ? "TXT up to 500k chars" : spec?.kind === "markdown-to-pdf" ? "MD up to 300k chars"
    : spec?.kind === "csv-to-pdf" ? "CSV up to 5,000 rows"
    : spec?.kind === "word-to-pdf" ? "DOCX up to 25 MB" : spec?.kind === "excel-to-pdf" ? "XLSX up to 25 MB"
    : "PDF up to 100 MB";

  return (
    <main className="flex flex-col min-h-screen bg-surface">
      <header className="w-full bg-surface-container-lowest border-b border-outline-variant/30 px-4 lg:px-8 py-3.5 sticky top-20 z-40 backdrop-blur-md shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-0.5">
            <h1 className="text-xl font-headline font-bold text-on-surface tracking-tight">
              {toolName}
            </h1>
            <p className="text-xs text-on-surface-variant">{toolDesc}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-secondary-container/70 text-primary border border-primary/20">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Private &amp; Secure (On-device)
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto w-full px-4 lg:px-8 py-6 space-y-6">
        <section className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-sm">
          <nav className="flex items-center gap-3 overflow-x-auto">
            <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary border border-primary/20 transition-all">
              <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-[11px] font-bold flex items-center justify-center">
                1
              </span>
              Upload
            </button>
            <span className="text-outline-variant text-xs">→</span>
            <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all">
              <span className="w-5 h-5 rounded-full bg-surface-container text-on-surface-variant border border-outline-variant/30 text-[11px] font-semibold flex items-center justify-center">
                2
              </span>
              Process
            </button>
            <span className="text-outline-variant text-xs">→</span>
            <button className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all">
              <span className="w-5 h-5 rounded-full bg-surface-container text-on-surface-variant border border-outline-variant/30 text-[11px] font-semibold flex items-center justify-center">
                3
              </span>
              Download
            </button>
          </nav>
          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-[16px] text-outline">
              info
            </span>
            Files are processed directly in your browser
          </div>
        </section>

        {!spec && !isSoon && (
          <div className="p-4 rounded-xl border border-outline-variant/30 bg-surface-container-lowest text-xs text-on-surface-variant">
            The local engine for “{toolName}” ships in a later tier. Available now: Merge, Split,
            Images→PDF, Rotate, Delete, Extract, PDF→Image, PDF→Text, Watermark, Page Numbers, Crop, Compress — all on-device.
          </div>
        )}

        {isSoon && (
          <div className="p-8 sm:p-12 rounded-2xl border border-dashed border-outline-variant/50 bg-surface-container-lowest text-center shadow-sm">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-xs font-bold uppercase tracking-wider mb-4">
              Coming soon
            </div>
            <h2 className="text-xl font-headline font-bold text-on-surface">{toolName} is on the roadmap</h2>
            <p className="text-sm text-on-surface-variant mt-2 max-w-xl mx-auto leading-relaxed">
              {toolDesc} This engine needs heavier native tooling (LibreOffice, Tesseract, Ghostscript,
              or PKI signing) that we have not finished packaging for on-device use yet. Your files never
              leave your device — we would rather mark it honestly than ship a half-working converter.
            </p>
            <p className="text-xs text-on-surface-variant mt-4">
              Meanwhile, {`41`} local engines are ready — try Merge, Compress, or PDF→Word.
            </p>
          </div>
        )}

        {!isSoon && (
        <div className="space-y-6">
          <div
            className={`group relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all cursor-pointer shadow-sm overflow-hidden ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-outline-variant/50 hover:border-primary bg-surface-container-lowest hover:bg-primary/5"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="absolute inset-0 opacity-40 pointer-events-none bg-[radial-gradient(var(--tw-color-outline-variant)_1px,transparent_1px)] [background-size:16px_16px]" />
            <div className="relative z-10 flex flex-col items-center justify-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-secondary-container/70 border border-primary/20 group-hover:scale-105 transition-all flex items-center justify-center text-primary shadow-sm">
                <span className="material-symbols-outlined text-3xl">
                  cloud_upload
                </span>
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-on-surface">
                  Drop your {uploadNoun} here, or{" "}
                  <span className="text-primary underline underline-offset-4 decoration-primary/40 font-semibold">
                    browse files
                  </span>
                </h2>
                <p className="text-xs text-on-surface-variant">
                  {spec?.kind === "compare" ? "Two files, added one at a time · original first" : "One file at a time"} · fast, local, completely private
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <span className="px-2.5 py-1 rounded-md text-xs bg-surface-container text-on-surface-variant border border-outline-variant/30">
                  {uploadHint}
                  {isQueue ? ` · add one at a time (free: ${queueLimit})` : ""}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptAttr}
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          </div>

          {files.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant flex items-center gap-2">
                  Selected {spec?.kind === "images-to-pdf" ? "Images" : spec?.kind === "compare" ? "PDFs (need 2)" : spec?.kind === "svg-to-pdf" || spec?.kind === "text-to-pdf" || spec?.kind === "markdown-to-pdf" || spec?.kind === "csv-to-pdf" ? "Files" : "Documents"}
                  <span className="px-2 py-0.5 rounded-full bg-secondary-container/70 border border-primary/20 text-primary text-[10px] font-bold">
                    {files.length} File{files.length > 1 ? "s" : ""}
                  </span>
                </h3>
                <button onClick={clearAll} className="text-xs text-on-surface-variant hover:text-error transition-colors">
                  Clear all
                </button>
              </div>
              {files.map((file, i) => (
                <div key={`${file.name}-${file.size}-${i}`} className="p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/30 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-secondary-container/70 flex items-center justify-center text-primary shrink-0">
                      <span className="material-symbols-outlined text-[20px]">
                        description
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">
                        {i + 1}. {file.name}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isQueue && (
                      <>
                        <button
                          onClick={() => moveFile(i, -1)}
                          disabled={i === 0}
                          className="p-2 rounded-lg hover:bg-surface-container-high disabled:opacity-30 transition-colors text-xs"
                          aria-label="Move up"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => moveFile(i, 1)}
                          disabled={i === files.length - 1}
                          className="p-2 rounded-lg hover:bg-surface-container-high disabled:opacity-30 transition-colors text-xs"
                          aria-label="Move down"
                        >
                          ↓
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => removeFile(i)}
                      className="p-2 rounded-lg hover:bg-error-container hover:text-error transition-colors"
                      aria-label="Remove file"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        close
                      </span>
                    </button>
                  </div>
                </div>
              ))}
              {isQueue && (
                <p className="text-[11px] text-on-surface-variant px-1">
                  Free plan: up to {queueLimit} files per job. Need bulk batches? That’s a premium feature.
                </p>
              )}
            </div>
          )}

          {spec && files.length > 0 && (
            <div className="p-5 bg-surface-container-lowest rounded-xl border border-outline-variant/30 space-y-4">
              {showRanges && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-on-surface">Page ranges (one output per range)</span>
                  <input
                    value={rangeInput}
                    onChange={(e) => setRangeInput(e.target.value)}
                    placeholder="1-3, 4-6"
                    className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-[11px] text-on-surface-variant">Example: 1-3, 5, 7-9</span>
                </label>
              )}
              {showKeepPages && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-on-surface">Pages to keep</span>
                  <input
                    value={pagesInput || rangeInput}
                    onChange={(e) => { setPagesInput(e.target.value); setRangeInput(e.target.value); }}
                    placeholder="1-3, 8"
                    className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
              )}
              {showDeletePages && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-on-surface">Pages to delete</span>
                  <input
                    value={pagesInput}
                    onChange={(e) => setPagesInput(e.target.value)}
                    placeholder="2, 5-7"
                    className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
              )}
              {showRotate && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Rotation</span>
                    <div className="flex gap-2">
                      {[90, 180, 270].map((a) => (
                        <button
                          key={a}
                          onClick={() => setAngle(a as 90 | 180 | 270)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            angle === a
                              ? "bg-primary text-on-primary"
                              : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {a}°
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="block space-y-1.5 flex-1">
                    <span className="text-xs font-semibold text-on-surface">Pages (empty = all)</span>
                    <input
                      value={pagesInput}
                      onChange={(e) => setPagesInput(e.target.value)}
                      placeholder="1-3, 5"
                      className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                </div>
              )}
              {showImgOpts && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Quality</span>
                    <div className="flex gap-2">
                      {([1, 2, 3] as const).map((q) => (
                        <button
                          key={q}
                          onClick={() => setImgQuality(q)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            imgQuality === q
                              ? "bg-primary text-on-primary"
                              : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {q === 1 ? "72 dpi" : q === 2 ? "150 dpi" : "220 dpi"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="block space-y-1.5 flex-1">
                    <span className="text-xs font-semibold text-on-surface">Pages (empty = all)</span>
                    <input
                      value={pagesInput}
                      onChange={(e) => setPagesInput(e.target.value)}
                      placeholder="1-3, 5"
                      className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                </div>
              )}
              {showTextPages && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-on-surface">Pages (empty = all)</span>
                  <input
                    value={pagesInput}
                    onChange={(e) => setPagesInput(e.target.value)}
                    placeholder="1-3, 5"
                    className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </label>
              )}
              {showWatermark && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <label className="block space-y-1.5 flex-1">
                    <span className="text-xs font-semibold text-on-surface">Watermark text</span>
                    <input
                      value={watermarkText}
                      onChange={(e) => setWatermarkText(e.target.value)}
                      placeholder="CONFIDENTIAL"
                      maxLength={80}
                      className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                  <label className="block space-y-1.5 sm:w-48">
                    <span className="text-xs font-semibold text-on-surface">Opacity · {watermarkOpacity}%</span>
                    <input
                      type="range"
                      min={5}
                      max={50}
                      value={watermarkOpacity}
                      onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </label>
                </div>
              )}
              {showNumbering && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <label className="block space-y-1.5 sm:w-40">
                    <span className="text-xs font-semibold text-on-surface">Start from</span>
                    <input
                      value={numStart}
                      onChange={(e) => setNumStart(e.target.value)}
                      inputMode="numeric"
                      className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Position</span>
                    <div className="flex gap-2">
                      {(["bottom-center", "bottom-right"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setNumPos(p)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            numPos === p
                              ? "bg-primary text-on-primary"
                              : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {p === "bottom-center" ? "Center" : "Right"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {showCrop && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <label className="block space-y-1.5 sm:w-48">
                    <span className="text-xs font-semibold text-on-surface">Trim each side (pt)</span>
                    <input
                      value={cropMargin}
                      onChange={(e) => setCropMargin(e.target.value)}
                      inputMode="decimal"
                      placeholder="36"
                      className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-[11px] text-on-surface-variant">72 pt = 1 inch</span>
                  </label>
                  <label className="block space-y-1.5 flex-1">
                    <span className="text-xs font-semibold text-on-surface">Pages (empty = all)</span>
                    <input
                      value={pagesInput}
                      onChange={(e) => setPagesInput(e.target.value)}
                      placeholder="1-3, 5"
                      className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </label>
                </div>
              )}
              {showCompress && (
                <p className="text-[11px] text-on-surface-variant">
                  v1 rewrites the file with object streams and strips identifying metadata.
                  Image downsampling ships in a later tier.
                </p>
              )}

              {showBates && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <label className="block space-y-1.5 flex-1">
                    <span className="text-xs font-semibold text-on-surface">Prefix</span>
                    <input value={batesPrefix} onChange={(e) => setBatesPrefix(e.target.value)} placeholder="ACME-" maxLength={24} className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                  </label>
                  <label className="block space-y-1.5 sm:w-32">
                    <span className="text-xs font-semibold text-on-surface">Start at</span>
                    <input value={batesStart} onChange={(e) => setBatesStart(e.target.value)} inputMode="numeric" className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                  </label>
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Position</span>
                    <div className="flex flex-wrap gap-2">
                      {(["bottom-right", "bottom-center", "top-right", "top-center"] as const).map((p) => (
                        <button key={p} onClick={() => setBatesPos(p)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${batesPos === p ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}>
                          {p.replace("-", " ")}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {showHeaderFooter && (
                <div className="flex flex-col gap-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Header (centered, every page)</span>
                    <input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="ACME Corp — Confidential" maxLength={120} className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Footer (centered, every page)</span>
                    <input value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="Page {p} of {n}" maxLength={120} className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                    <span className="text-[11px] text-on-surface-variant">Use {"{p}"} for page number, {"{n}"} for total pages.</span>
                  </label>
                </div>
              )}
              {showStamp && (
                <div className="flex flex-col gap-4">
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Stamp</span>
                    <div className="flex flex-wrap gap-2">
                      {(["APPROVED", "CONFIDENTIAL", "DRAFT", "REVIEWED", "VOID", "CUSTOM"] as const).map((p) => (
                        <button key={p} onClick={() => setStampPreset(p)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${stampPreset === p ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  {stampPreset === "CUSTOM" && (
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-on-surface">Custom text</span>
                      <input value={stampText} onChange={(e) => setStampText(e.target.value.toUpperCase())} placeholder="PRELIMINARY" maxLength={40} className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                    </label>
                  )}
                </div>
              )}
              {showToc && (
                <div className="flex flex-col gap-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">TOC title</span>
                    <input value={tocTitle} onChange={(e) => setTocTitle(e.target.value)} maxLength={80} className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Entries (one per line)</span>
                    <textarea value={tocEntriesInput} onChange={(e) => setTocEntriesInput(e.target.value)} rows={5} placeholder={"Introduction | 1\nResults | 3"} className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
                    <span className="text-[11px] text-on-surface-variant">Format: Title | page. Entries become clickable links to the page.</span>
                  </label>
                </div>
              )}
              {showSign && (
                <div className="flex flex-col gap-4">
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Signature source</span>
                    <div className="flex gap-2">
                      {(["text", "image"] as const).map((m) => (
                        <button key={m} onClick={() => setSignMode(m)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${signMode === m ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}>
                          {m === "text" ? "Type name" : "Upload image"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {signMode === "text" ? (
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-on-surface">Name</span>
                      <input value={signText} onChange={(e) => setSignText(e.target.value)} placeholder="Jane Doe" maxLength={60} className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                    </label>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button onClick={() => signImageRef.current?.click()} className="px-4 py-2 text-xs font-semibold rounded-lg bg-surface-container-high text-on-surface hover:text-primary transition-colors">
                        {signImage ? "Change image…" : "Choose signature PNG/JPG…"}
                      </button>
                      {signImage && <span className="text-xs text-on-surface-variant">{signImage.name}</span>}
                      <input ref={signImageRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { setSignImage(e.target.files?.[0] ?? null); if (signImageRef.current) signImageRef.current.value = ""; }} />
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="space-y-1.5">
                      <span className="text-xs font-semibold text-on-surface">Position</span>
                      <div className="flex gap-2">
                        {(["bottom-left", "bottom-center", "bottom-right"] as const).map((p) => (
                          <button key={p} onClick={() => setSignPos(p)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${signPos === p ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}>
                            {p === "bottom-left" ? "Left" : p === "bottom-center" ? "Center" : "Right"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="block space-y-1.5 flex-1">
                      <span className="text-xs font-semibold text-on-surface">Pages (empty = last page)</span>
                      <input value={signPagesInput} onChange={(e) => setSignPagesInput(e.target.value)} placeholder="2, 5" className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                    </label>
                  </div>
                  <p className="text-[11px] text-on-surface-variant">Visual mark only — cryptographic PKCS#7 signing ships in a later tier.</p>
                </div>
              )}
              {showFormFill && (
                <div className="flex flex-col gap-3">
                  <span className="text-xs font-semibold text-on-surface">Fields in this form</span>
                  {formFields === null && <p className="text-xs text-on-surface-variant">Select a PDF to list its fields…</p>}
                  {formFields !== null && formFields.length === 0 && <p className="text-xs text-on-surface-variant">No fillable fields found (or still loading).</p>}
                  {formFields !== null && formFields.length > 0 && formFields.map((fld) => (
                    <label key={fld.name} className="flex items-center gap-3 text-xs">
                      <span className="w-40 shrink-0 truncate font-medium text-on-surface" title={fld.name}>{fld.name}</span>
                      {fld.type === "checkbox" ? (
                        <input type="checkbox" checked={formValues[fld.name] === true} onChange={(e) => setFormValues((v) => ({ ...v, [fld.name]: e.target.checked }))} className="w-4 h-4 accent-primary" />
                      ) : fld.type === "dropdown" || fld.type === "radio" ? (
                        <select value={String(formValues[fld.name] ?? "")} onChange={(e) => setFormValues((v) => ({ ...v, [fld.name]: e.target.value }))} className="flex-1 text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface focus:outline-none focus:ring-1 focus:ring-primary">
                          <option value="">—</option>
                          {(fld.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input value={String(formValues[fld.name] ?? "")} onChange={(e) => setFormValues((v) => ({ ...v, [fld.name]: e.target.value }))} placeholder={fld.type} className="flex-1 text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                      )}
                    </label>
                  ))}
                </div>
              )}
              {showBookmarks && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-on-surface">Bookmark outline</span>
                  {bmTree === null && <p className="text-xs text-on-surface-variant">Select a PDF to load its bookmarks…</p>}
                  {bmTree !== null && bmTree.length === 0 && <p className="text-xs text-on-surface-variant">No bookmarks yet — add the first one below.</p>}
                  {bmTree !== null && renderBmNodes(bmTree, 0)}
                  <div className="flex items-center gap-1.5 pt-1">
                    <input value={bmNewTitle} onChange={(e) => setBmNewTitle(e.target.value)} placeholder="New bookmark title" maxLength={200} className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                    <input type="number" min={1} value={bmNewPage} onChange={(e) => setBmNewPage(e.target.value)} title="Target page" className="w-14 shrink-0 text-xs px-2 py-1.5 rounded-lg bg-surface-container-high text-on-surface focus:outline-none focus:ring-1 focus:ring-primary" />
                    <button onClick={bmAddTop} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-on-primary">Add</button>
                  </div>
                  <p className="text-[11px] text-on-surface-variant">Destinations use page fit. Empty the list to strip all bookmarks.</p>
                </div>
              )}
              {(showSvg || spec?.kind === "rasterize") && (
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-on-surface">Render resolution</span>
                  <div className="flex gap-2">
                    {([1, 2, 3] as const).map((q) => (
                      <button key={q} onClick={() => setImgQuality(q)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${imgQuality === q ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}>
                        {q === 1 ? "72 dpi" : q === 2 ? "150 dpi" : "220 dpi"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {showText && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <label className="block space-y-1.5 flex-1">
                    <span className="text-xs font-semibold text-on-surface">Title (optional)</span>
                    <input value={textTitle} onChange={(e) => setTextTitle(e.target.value)} maxLength={100} className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                  </label>
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Font size</span>
                    <div className="flex gap-2">
                      {(["10", "11", "14"] as const).map((s) => (
                        <button key={s} onClick={() => setTextSize(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${textSize === s ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}>
                          {s}pt
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {showCsv && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <label className="flex items-center gap-2 text-xs font-medium text-on-surface cursor-pointer">
                    <input type="checkbox" checked={csvHeader} onChange={(e) => setCsvHeader(e.target.checked)} className="w-4 h-4 accent-primary" />
                    First row is a header
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-on-surface cursor-pointer">
                    <input type="checkbox" checked={csvLandscape} onChange={(e) => setCsvLandscape(e.target.checked)} className="w-4 h-4 accent-primary" />
                    Landscape pages
                  </label>
                </div>
              )}
              {showConverterPages && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-on-surface">Pages (empty = all)</span>
                  <input value={pagesInput} onChange={(e) => setPagesInput(e.target.value)} placeholder="1-3, 5" className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                </label>
              )}
              {showDuplicate && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-on-surface">Page order</span>
                  <input value={dupOrderInput} onChange={(e) => setDupOrderInput(e.target.value)} placeholder="3, 1-2, 1" className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary font-mono" />
                  <span className="text-[11px] text-on-surface-variant">Repeats duplicate the page — “1-3, 1” appends a copy of page 1.</span>
                </label>
              )}
              {spec?.kind === "compare" && (
                <p className="text-[11px] text-on-surface-variant">Add the original PDF first, then the revised one. Output is a Markdown report with per-page similarity and line diffs.</p>
              )}
              {spec?.kind === "repair" && (
                <p className="text-[11px] text-on-surface-variant">Rebuilds broken cross-reference tables via the qpdf engine. Encrypted files must be unlocked first.</p>
              )}
              {spec?.kind === "flatten" && (
                <p className="text-[11px] text-on-surface-variant">Bakes AcroForm field values into static content. The file will no longer be editable as a form.</p>
              )}
              {spec?.kind === "remove-metadata" && (
                <p className="text-[11px] text-on-surface-variant">Strips the Info dictionary (title, author, dates…), XMP stream and PieceInfo.</p>
              )}
              {spec?.kind === "extract-images" && (
                <p className="text-[11px] text-on-surface-variant">Pull embedded raster images as PNGs. Vector drawings and tiny fragments are skipped.</p>
              )}
              {showPageSize && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Target size</span>
                    <div className="flex flex-wrap gap-2">
                      {(["A4", "Letter", "Legal", "A3"] as const).map((t) => (
                        <button key={t} onClick={() => setPageSizeTarget(t)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${pageSizeTarget === t ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-on-surface">Orientation</span>
                    <div className="flex gap-2">
                      {(["auto", "portrait", "landscape"] as const).map((o) => (
                        <button key={o} onClick={() => setPageSizeOrientation(o)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${pageSizeOrientation === o ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}>
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {showProtect && (
                <div className="flex flex-col sm:flex-row gap-4">
                  <label className="block space-y-1.5 flex-1">
                    <span className="text-xs font-semibold text-on-surface">Password</span>
                    <input type="password" value={protectPw} onChange={(e) => setProtectPw(e.target.value)} autoComplete="new-password" className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                  </label>
                  <label className="block space-y-1.5 flex-1">
                    <span className="text-xs font-semibold text-on-surface">Confirm password</span>
                    <input type="password" value={protectPw2} onChange={(e) => setProtectPw2(e.target.value)} autoComplete="new-password" className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                  </label>
                </div>
              )}
              {showUnlock && (
                <label className="block space-y-1.5 max-w-sm">
                  <span className="text-xs font-semibold text-on-surface">File password</span>
                  <input type="password" value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)} autoComplete="current-password" className="w-full text-sm px-3 py-2 rounded-lg bg-surface-container-high text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary" />
                </label>
              )}
              {showSanitize && (
                <div className="flex flex-col gap-2.5">
                  <span className="text-xs font-semibold text-on-surface">Scrub targets</span>
                  {([
                    ["Metadata (title, author, dates, XMP)", sanMeta, setSanMeta],
                    ["JavaScript, open actions & triggers", sanJs, setSanJs],
                    ["Annotations (comments, links, markup)", sanAnnots, setSanAnnots],
                    ["Interactive forms", sanForms, setSanForms],
                  ] as const).map(([label, val, set]) => (
                    <label key={label} className="flex items-center gap-2 text-xs font-medium text-on-surface cursor-pointer">
                      <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} className="w-4 h-4 accent-primary" />
                      {label}
                    </label>
                  ))}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  onClick={handleProcess}
                  disabled={busy || files.length === 0}
                  className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-primary text-on-primary hover:bg-primary-container disabled:opacity-50 transition-colors"
                >
                  {busy ? (loadingEngine ? "Loading engine…" : `Processing… ${progress}%`) : `Process locally`}
                </button>
                {result && (
                  <button
                    onClick={handleDownload}
                    className="px-5 py-2.5 text-sm font-semibold rounded-xl bg-secondary-container text-primary hover:bg-secondary-fixed transition-colors"
                  >
                    Download result
                  </button>
                )}
              </div>

              {(busy || status) && !error && (
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {status && <p className="text-xs text-on-surface-variant">{status}</p>}
                </div>
              )}
              {error && (
                <p className="text-xs font-medium text-error bg-error-container/50 border border-error/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              {result && (
                <p className="text-xs text-on-surface-variant">
                  Ready: {Array.isArray(result.names) ? result.names.join(", ") : result.names}.
                  {result.summary ? ` ${result.summary}.` : ""} Files never left your device.
                </p>
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </main>
  );
}
