export type ProgressCallback = (progress: number, message?: string) => void;

export interface ProcessInput {
  files: File[];
  options?: Record<string, unknown>;
}

export interface ProcessSuccess {
  success: true;
  result: Blob | Blob[];
  filename: string | string[];
  metadata?: Record<string, unknown>;
}

export interface ProcessFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: string;
  };
}

export type ProcessOutput = ProcessSuccess | ProcessFailure;

export interface PageRange {
  start: number;
  end: number;
}

export interface ToolSpec {
  slug: string;
  title: string;
  description: string;
  accepts: string[];
  acceptMime: string;
  multiple: boolean;
  kind:
    | "merge"
    | "split"
    | "images-to-pdf"
    | "rotate"
    | "delete-pages"
    | "extract-pages"
    | "pdf-to-image"
    | "pdf-to-text"
    | "watermark"
    | "page-numbers"
    | "crop"
    | "compress"
    | "bates"
    | "header-footer"
    | "stamp"
    | "toc"
    | "sign"
    | "form-fill"
    | "svg-to-pdf"
    | "text-to-pdf"
    | "markdown-to-pdf"
    | "csv-to-pdf"
    | "pdf-to-word"
    | "pdf-to-excel"
    | "extract-images"
    | "pdf-to-csv"
    | "duplicate"
    | "compare"
    | "page-size"
    | "repair"
    | "rasterize"
    | "protect"
    | "unlock"
    | "sanitize"
    | "flatten"
    | "remove-metadata"
    | "bookmarks"
    | "word-to-pdf"
    | "excel-to-pdf"
    | "deskew"
    | "unsupported";
}
