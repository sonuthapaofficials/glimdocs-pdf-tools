"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { FaApple, FaStripe } from "react-icons/fa"
import { preloadToolEngines } from "../../lib/pdf/preload"

// URL-safe card slugs: registry slugs are [a-z0-9-] only — raw "&" and
// "/" are not valid path segments (they broke crawlability and produced
// escaped URLs). Keep in sync with TIER1_TOOLS keys and COMING_SOON.
function cardHref(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `/free-tools/${slug}`
}

interface CatalogTool {
  icon: string
  title: string
  desc: string
  badge: string
  badgeColor: string
  action: string
  tags: string
  soon?: boolean
}

const catalogTools: CatalogTool[] = [
  { icon: "call_merge", title: "Merge PDF", desc: "Unlimited pages, rearrange order on infinite canvas with zero lag.", badge: "WASM v3.2", badgeColor: "primary", action: "Open Engine", tags: "merge combine join organize" },
  { icon: "compress", title: "Compress PDF", desc: "Adaptive DCT quantization, Flate stream re-encoding, and vector preservation.", badge: "-85% Ratio", badgeColor: "tertiary", action: "Optimize", tags: "compress shrink optimize reduce dpi" },
  { icon: "document_scanner", title: "OCR PDF", desc: "30+ vocabularies loaded dynamically via WebAssembly SIMD pipelines.", badge: "Tesseract 5", badgeColor: "primary", action: "Scan Document", tags: "ocr optical recognition scan text extract", soon: true },
  { icon: "table_view", title: "PDF to Excel", desc: "Spatial table detection into one sheet per table.", badge: "XLSX Native", badgeColor: "primary", action: "Convert Table", tags: "excel xlsx convert spreadsheet table" },
  { icon: "draw", title: "Sign PDF", desc: "Cryptographic visual signing, audit hash creation, and key generation.", badge: "X.509 Crypt", badgeColor: "primary", action: "Sign File", tags: "sign signature esign x509 audit certificate" },
]

const categories = [
  { id: "all", label: "All (50)" },
  { id: "popular", label: "Popular (8)" },
  { id: "edit-annotate", label: "Edit & Annotate (10)" },
  { id: "convert-to", label: "Convert to PDF (12)" },
  { id: "convert-from", label: "Convert from PDF (8)" },
  { id: "organize", label: "Organize & Manage (7)" },
  { id: "optimize", label: "Optimize & Repair (6)" },
  { id: "secure", label: "Secure PDF (6)" },
]

const quickActions = [
  { icon: "call_merge", label: "Merge PDF", href: "/free-tools/merge-pdf" },
  { icon: "call_split", label: "Split PDF", href: "/free-tools/split-pdf" },
  { icon: "compress", label: "Compress PDF", href: "/free-tools/compress-pdf" },
  { icon: "document_scanner", label: "OCR PDF", href: "/free-tools/ocr-pdf" },
  { icon: "image", label: "JPG to PDF", href: "/free-tools/jpg-to-pdf" },
  { icon: "description", label: "PDF to Word", href: "/free-tools/pdf-to-word" },
  { icon: "draw", label: "Sign PDF", href: "/free-tools/sign-pdf" },
]

interface ToolItem {
  icon: string
  title: string
  desc: string
  tags: string
  soon?: boolean
}

interface CategorySection {
  id: string
  icon: string
  title: string
  subtitle: string
  count: number
  tools: ToolItem[]
}

const categorySections: CategorySection[] = [
  {
    id: "edit-annotate", icon: "ink_pen", title: "Edit & Annotate", subtitle: "In-line text updates, bates stamping, form elements & redaction", count: 10,
    tools: [
      { icon: "bookmark_manager", title: "Edit Bookmarks", desc: "Read, reorder, rename, and rebuild outlines.", tags: "bookmarks outline tree index" },
      { icon: "toc", title: "Table of Contents", desc: "Auto-generate hyperlinked index pages.", tags: "table of contents toc generate index" },
      { icon: "pin", title: "Page Numbers", desc: "Position, font style, roman numeral formats.", tags: "page numbers pagination numbering footer" },
      { icon: "format_list_numbered", title: "Bates Numbering", desc: "Legal litigation discovery numbering.", tags: "bates numbering legal discovery indexing" },
      { icon: "branding_watermark", title: "Add Watermark", desc: "Text or image diagonal security layers.", tags: "watermark draft confidential overlay" },
      { icon: "top_panel_close", title: "Header & Footer", desc: "Multi-line headers, dynamic dates, metadata.", tags: "header footer page margins" },
      { icon: "signature", title: "Sign PDF", desc: "Draw, type, or upload visual signatures.", tags: "sign esign signature signature pad" },
      { icon: "approval", title: "Add Stamps", desc: "Approved, Confidential, Void overlays.", tags: "stamps approved rejected confidential badge" },
      { icon: "crop", title: "Crop PDF", desc: "Trim bleed margins and white margins.", tags: "crop trim cut margins resize" },
      { icon: "dynamic_form", title: "PDF Form Filler", desc: "Fill AcroForms and XFA interactive fields.", tags: "form filler acroform interactive input" },
    ],
  },
  {
    id: "convert-to", icon: "upload_file", title: "Convert to PDF", subtitle: "Compile raster graphics, office formats, and markup to vector documents", count: 12,
    tools: [
      { icon: "photo_library", title: "Images to PDF", desc: "Multi-image batch stitching to single page.", tags: "images jpg jpeg png to pdf converter" },
      { icon: "image", title: "JPG to PDF", desc: "Preserve EXIF rotation and color space.", tags: "jpg jpeg to pdf photo" },
      { icon: "landscape", title: "PNG to PDF", desc: "Retain full 8-bit alpha channels.", tags: "png to pdf transparency" },
      { icon: "filter", title: "WebP to PDF", desc: "Lossless Google WebP decoder engine.", tags: "webp to pdf modern images" },
      { icon: "polyline", title: "SVG to PDF", desc: "Pure vector node and Bezier reproduction.", tags: "svg vector to pdf scalable" },
      { icon: "article", title: "Word to PDF", desc: "DOCX paragraphs, headings, and tables to PDF.", tags: "word doc docx to pdf office" },
      { icon: "grid_on", title: "Excel to PDF", desc: "XLSX worksheets rendered as bordered tables.", tags: "excel xls xlsx to pdf sheets spreadsheet" },
      { icon: "co_present", title: "PowerPoint to PDF", desc: "High fidelity presentation slides to pages.", tags: "powerpoint ppt pptx to pdf slides", soon: true },
      { icon: "text_snippet", title: "Text to PDF", desc: "Monospace or custom typography layout.", tags: "text txt to pdf monospace plaintext" },
      { icon: "code_blocks", title: "Markdown to PDF", desc: "GFM syntax, table formatting, syntax highlight.", tags: "markdown md to pdf github syntax" },
      { icon: "reorder", title: "CSV to PDF", desc: "Delimited plain data structured to reports.", tags: "csv to pdf data table" },
      { icon: "menu_book", title: "EPUB to PDF", desc: "Reflowable electronic books into fixed PDF.", tags: "epub to pdf ebook reader", soon: true },
    ],
  },
  {
    id: "convert-from", icon: "download_for_offline", title: "Convert from PDF", subtitle: "Extract text tokens, embedded media, and structured datasets", count: 8,
    tools: [
      { icon: "description", title: "PDF to Word", desc: "Convert layout elements to editable DOCX.", tags: "pdf to word docx extract editable" },
      { icon: "table_chart", title: "PDF to Excel", desc: "Export tables into clean XLSX sheets.", tags: "pdf to excel xlsx sheets table tabular" },
      { icon: "hide_image", title: "PDF to JPG", desc: "Export high resolution page frames.", tags: "pdf to jpg raster image export" },
      { icon: "image", title: "PDF to PNG", desc: "Lossless alpha-ready page captures.", tags: "pdf to png lossless export graphics" },
      { icon: "markdown", title: "PDF to Markdown", desc: "LLM-ready parsed markdown headings.", tags: "pdf to markdown md text docs" },
      { icon: "gallery_thumbnail", title: "Extract Images", desc: "Isolate embedded JPEGs and PNG bitmaps.", tags: "extract images rip media graphics" },
      { icon: "dataset", title: "PDF to CSV", desc: "Dump raw parsed table contents to CSV.", tags: "pdf to csv data spreadsheet tabular" },
      { icon: "format_align_left", title: "PDF to Text", desc: "Pure raw text streams with reading order.", tags: "pdf to text txt extract ocr copy" },
    ],
  },
  {
    id: "organize", icon: "layers", title: "Organize & Manage", subtitle: "Reorder, split, compare, rotate, and reconstruct page structures", count: 7,
    tools: [
      { icon: "call_merge", title: "Merge PDF", desc: "Combine multiple files into a single bundle.", tags: "merge combine join unite" },
      { icon: "call_split", title: "Split PDF", desc: "Extract page sets or slice by bookmark.", tags: "split divide cut range" },
      { icon: "rotate_right", title: "Rotate PDF", desc: "90°, 180°, 270° orientation corrections.", tags: "rotate orientation turn degree" },
      { icon: "delete_sweep", title: "Delete Pages", desc: "Prune unwanted leaves or whole ranges.", tags: "delete remove delete pages prune" },
      { icon: "view_stream", title: "Duplicate & Organize", desc: "Clone pages, re-sequence thumbnails.", tags: "duplicate organize drag drop reorder" },
      { icon: "file_open", title: "Extract Pages", desc: "Pick non-contiguous sheets into new file.", tags: "extract pages pull select" },
      { icon: "difference", title: "Compare PDFs", desc: "Visual pixel diff and text delta analyzer.", tags: "compare diff version compare changes" },
    ],
  },
  {
    id: "optimize", icon: "build_circle", title: "Optimize & Repair", subtitle: "Compression, PDF/A compliance, corrupt xref fixes & deskewing", count: 6,
    tools: [
      { icon: "compress", title: "Compress PDF", desc: "Deep byte-reduction for email & uploads.", tags: "compress shrink optimize size" },
      { icon: "inventory_2", title: "PDF to PDF/A", desc: "ISO 19005 long-term preservation spec.", tags: "pdfa archive long term iso compliant", soon: true },
      { icon: "aspect_ratio", title: "Fix Page Size", desc: "Standardize irregular pages to A4 or US Letter.", tags: "fix page size a4 letter format" },
      { icon: "healing", title: "Repair PDF", desc: "Rebuild broken XREF tables & trailer blocks.", tags: "repair fix damaged corrupt recover" },
      { icon: "blur_on", title: "Rasterize PDF", desc: "Bake all layers into un-selectable bitmaps.", tags: "rasterize flatten vectors bitmap" },
      { icon: "straighten", title: "Deskew PDF", desc: "Auto-straighten slanted scans, per-page tilt detection.", tags: "deskew straighten align tilt scan" },
    ],
  },
  {
    id: "secure", icon: "verified_user", title: "Secure PDF", subtitle: "Cryptographic passwords, metadata scrubbing & sanitization", count: 6,
    tools: [
      { icon: "lock", title: "Protect PDF", desc: "AES-256 permission password encryption.", tags: "protect encrypt password lock aes" },
      { icon: "cleaning_services", title: "Sanitize PDF", desc: "Purge hidden scripts, links, and forms.", tags: "sanitize scrub clean privacy redact" },
      { icon: "lock_open", title: "Unlock PDF", desc: "Remove restrictions given valid password.", tags: "unlock decrypt remove password open" },
      { icon: "layers_clear", title: "Flatten PDF", desc: "Merge form fields and markup into page flow.", tags: "flatten annotations layers bake forms" },
      { icon: "info", title: "Remove Metadata", desc: "Strip author, machine name, and GPS coordinates.", tags: "remove metadata exif author scrub" },
      { icon: "assignment_turned_in", title: "Digital Signature PDF", desc: "PKCS#7 and PAdES-LTV certified signing.", tags: "digital signature pki pkcs x509 cert", soon: true },
    ],
  },
]

const complianceCards = [
  { icon: "policy", title: "GDPR Sovereign", desc: "No cross-border transfers occur. Data persistence is limited to active browser thread RAM.", badge: "ARTICLE 25 COMPLIANT" },
  { icon: "verified", title: "CCPA & CPRA", desc: "Zero sale or transmission of personal info. No diagnostic cookies or session trackers attached.", badge: "ZERO SALE GUARANTEE" },
  { icon: "health_and_safety", title: "HIPAA Air-Gap", desc: "Patient health identifiers (PHI) remain strictly on premise on local medical terminal hardware.", badge: "LOCAL PHI SANCTIONED" },
  { icon: "enhanced_encryption", title: "AES-256 Volatile", desc: "Transient memory buffers are securely scrubbed and zeroed immediately upon task completion.", badge: "EPHEMERAL HEAP ZEROED" },
]

export default function FreeToolsPage() {
  const [activeCategory, setActiveCategory] = useState("all")
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        document.getElementById("toolSearchInput")?.focus()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  const matchesSearch = (tags: string, title: string) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (title + " " + tags).toLowerCase().includes(q)
  }

  const isCategoryVisible = (catId: string) => {
    if (activeCategory === "all") return true
    if (activeCategory === "popular") return catId === "organize"
    return activeCategory === catId
  }

  return (
    <main className="flex flex-col min-h-screen bg-surface">
      <section className="w-full bg-surface-container-low/80 backdrop-blur-md px-4 sm:px-6 lg:px-12 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-on-surface-variant font-medium">
            <span className="inline-flex relative w-2 h-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-container opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            <span className="font-semibold text-primary">100% Client-Side WebAssembly</span>
            <span className="text-outline-variant">•</span>
            <span className="hidden sm:inline">Zero Upload Guarantee</span>
            <span className="hidden sm:inline text-outline-variant">•</span>
            <span className="hidden md:inline">Zero Network Telemetry</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-secondary-container/60 text-[11px] font-mono font-medium text-on-secondary-container">
              <span className="material-symbols-outlined text-[14px]">shield</span>
              MEMORY: SANDBOX ISOLATED
            </span>
          </div>
        </div>
      </section>

      <section className="relative w-full px-4 sm:px-6 lg:px-12 pt-10 pb-14 bg-gradient-to-b from-surface via-surface-container-lowest to-surface">
        <div className="max-w-6xl mx-auto flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-secondary-container/70 shadow-sm mb-6">
            <span className="material-symbols-outlined text-primary text-[18px]" style={{ fontVariationSettings: '"FILL" 1' }}>verified</span>
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Air-Gapped Client Architecture</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-headline font-extrabold tracking-tight text-on-surface max-w-4xl leading-[1.12]">
            Free PDF tools. <span className="text-primary-container">Entirely in your browser.</span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-on-surface-variant max-w-2xl leading-relaxed">
            Merge, split, convert, sign, compress, OCR, and edit. Process high-density documents at native hardware speed. Your files never leave your device.
          </p>
          <div className="w-full max-w-3xl mt-8">
            <div className="relative flex items-center bg-surface-container-lowest rounded-2xl shadow-xl shadow-surface-tint/5 p-2 transition-all focus-within:shadow-md focus-within:shadow-primary/10">
              <span className="material-symbols-outlined text-outline ml-3 mr-2 text-[22px]">search</span>
              <input
                id="toolSearchInput"
                type="text"
                autoComplete="off"
                className="w-full bg-transparent py-2.5 text-sm sm:text-base text-on-surface placeholder:text-outline focus:outline-none"
                placeholder="Search tools... (e.g. merge, compress, ocr, bates numbering)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="hidden sm:flex items-center gap-1 bg-surface-container px-2.5 py-1 rounded-lg text-xs font-mono font-medium text-on-surface-variant">
                <span>⌘</span><span>K</span>
              </div>
              <button className="ml-2 inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-on-primary bg-primary-container hover:bg-primary rounded-xl transition-colors">
                Find
              </button>
            </div>
          </div>
          <div className="w-full max-w-4xl mt-6 flex flex-wrap items-center justify-center gap-2">
            {quickActions.map((qa) => (
              <a key={qa.label} href={qa.href} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-lowest text-xs font-medium text-on-surface hover:bg-secondary-container hover:text-primary transition-colors shadow-sm">
                <span className="material-symbols-outlined text-[15px] text-primary">{qa.icon}</span>
                {qa.label}
              </a>
            ))}
          </div>
          <div className="mt-10 pt-8 border-t border-outline-variant/30 w-full flex flex-col items-center justify-center gap-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-outline">Trusted by researchers, engineers & teams at</p>
            <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12 opacity-75 hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-2 text-outline hover:text-on-surface transition-colors cursor-default">
                <FaApple className="h-8 w-8" />
              </div>
              <div className="flex items-center gap-2 text-outline hover:text-on-surface transition-colors cursor-default">
                <span className="font-headline font-semibold text-base tracking-tight">Harvard</span>
              </div>
              <div className="flex items-center gap-2 text-outline hover:text-on-surface transition-colors cursor-default">
                <span className="font-headline font-semibold text-base tracking-tight">NASA</span>
              </div>
              <div className="flex items-center gap-2 text-outline hover:text-on-surface transition-colors cursor-default">
                <FaStripe className="h-8 w-8" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sticky top-16 z-40 w-full bg-surface-container-lowest/95 backdrop-blur-md shadow-sm px-4 sm:px-6 lg:px-12 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 overflow-x-auto">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs transition-all ${
                  activeCategory === cat.id
                    ? "bg-primary-container text-on-primary shadow-sm font-semibold"
                    : "bg-surface-container-low text-on-surface-variant font-medium hover:bg-secondary-container hover:text-primary"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="hidden xl:flex items-center gap-2 text-xs text-on-surface-variant shrink-0">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-mono text-[11px]">WASM JIT Ready</span>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-12 py-10 flex flex-col gap-8">
        <div className="flex-1 flex flex-col gap-14 min-w-0">
          <section className="flex flex-col gap-5">
            <div className="flex items-end justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-primary">Core Processing Units</span>
                <h2 className="text-2xl font-headline font-bold text-on-surface mt-1">Featured Local Engines</h2>
              </div>
              <span className="text-xs text-on-surface-variant hidden sm:inline">Compiled Rust & C++ to WebAssembly</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {catalogTools.map((tool) => (
                <Link key={tool.title} href={cardHref(tool.title)} onMouseEnter={preloadToolEngines} onFocus={preloadToolEngines} className="group relative flex flex-col justify-between p-5 rounded-2xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_300px]">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-xl bg-secondary-container/70 flex items-center justify-center text-primary group-hover:scale-105 transition-transform">
                        <span className="material-symbols-outlined text-[22px]">{tool.icon}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {tool.soon && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider bg-tertiary-fixed text-on-tertiary-fixed">Soon</span>
                        )}
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${
                          tool.badgeColor === "tertiary" ? "bg-tertiary-fixed text-on-tertiary-container" : "bg-primary-fixed text-on-primary-fixed"
                        }`}>{tool.badge}</span>
                      </div>
                    </div>
                    <h3 className="text-base font-bold text-on-surface group-hover:text-primary transition-colors">{tool.title}</h3>
                    <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">{tool.desc}</p>
                  </div>
                  <div className="mt-4 pt-3 flex items-center justify-between text-xs">
                    <span className="text-[11px] font-medium text-outline">Native Memory</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-primary">
                      {tool.action}
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          {categorySections.map((section) => {
            if (!isCategoryVisible(section.id)) return null
            const visibleTools = section.tools.filter((t) => matchesSearch(t.tags, t.title))
            if (visibleTools.length === 0) return null
            return (
              <section key={section.id} className="flex flex-col gap-4" id={`section-${section.id}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-secondary-container flex items-center justify-center text-primary">
                      <span className="material-symbols-outlined text-[18px]">{section.icon}</span>
                    </div>
                    <div>
                      <h2 className="text-lg font-headline font-bold text-on-surface">{section.title}</h2>
                      <p className="text-xs text-on-surface-variant">{section.subtitle}</p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-container text-on-surface-variant">{section.count} Tools</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {visibleTools.map((tool) => (
                    <Link key={tool.title} href={cardHref(tool.title)} onMouseEnter={preloadToolEngines} onFocus={preloadToolEngines} className="p-4 rounded-xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-all flex flex-col justify-between cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_220px]">
                      <div>
                        <div className="w-7 h-7 rounded-lg bg-surface-container flex items-center justify-center text-primary mb-2.5">
                          <span className="material-symbols-outlined text-[16px]">{tool.icon}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-on-surface">{tool.title}</h4>
                          {tool.soon && (
                            <span className="px-1.5 py-px rounded text-[10px] font-mono font-semibold uppercase tracking-wider bg-tertiary-fixed text-on-tertiary-fixed shrink-0">Soon</span>
                          )}
                        </div>
                        <p className="text-[11px] text-on-surface-variant mt-1">{tool.desc}</p>
                      </div>
                      <span className="mt-3 text-[11px] font-medium text-primary">{tool.soon ? "Roadmap →" : "Launch →"}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <section className="w-full bg-surface-container-lowest px-4 sm:px-6 lg:px-12 py-16 shadow-[0_-1px_12px_rgba(0,0,0,0.03)]">
        <div className="max-w-7xl mx-auto flex flex-col gap-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary-container/80 text-xs font-semibold text-primary mb-3">
                <span className="material-symbols-outlined text-[15px]">verified_user</span>
                <span>Cryptographic Privacy Isolation</span>
              </div>
              <h2 className="text-3xl font-headline font-bold text-on-surface tracking-tight">
                Your data never leaves your physical device.
              </h2>
            </div>
            <p className="text-sm text-on-surface-variant max-w-md">
              Every conversion byte and parsing vector runs inside your browser&apos;s V8 WebAssembly engine. No proxies, no external cloud storage, no training on your data.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {complianceCards.map((card) => (
              <div key={card.title} className="p-5 rounded-2xl bg-surface shadow-sm flex flex-col gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary-container/70 flex items-center justify-center text-primary">
                  <span className="material-symbols-outlined text-[22px]">{card.icon}</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-on-surface">{card.title}</h3>
                  <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">{card.desc}</p>
                </div>
                <div className="pt-2 mt-auto">
                  <span className="text-[11px] font-mono font-medium text-primary">{card.badge}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
