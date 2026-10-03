// Lazy qpdf-wasm engine (AES encrypt/decrypt + structural rebuild).
// The 1.3MB qpdf.wasm is served from /qpdf.wasm (staged by postinstall,
// immutable-cached by nginx) and loads only when a secure/optimize tool runs.
// Clean-room implementation: Emscripten FS + callMain lifecycle only.

export interface QpdfFS {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string, opts?: { encoding: string }): Uint8Array;
  unlink(path: string): void;
}

export interface QpdfInstance {
  callMain(args: string[]): unknown;
  FS: QpdfFS;
}

type QpdfFactory = (opts: { locateFile: () => string }) => Promise<QpdfInstance>;

let instancePromise: Promise<QpdfInstance> | null = null;

function wasmUrl(): string {
  // Browser: served static asset. Node (test harness, run from the repo
  // root): resolve the real file. cwd-based on purpose — no import.meta.url
  // relative path, so this file works at any nesting depth and bundlers
  // never try to statically resolve a node_modules asset into the client.
  if (typeof window !== "undefined") return "/qpdf.wasm";
  return `file://${process.cwd()}/node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm`;
}

export function loadQpdf(): Promise<QpdfInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const mod = (await import("@neslinesli93/qpdf-wasm")) as unknown as {
        default: QpdfFactory;
      };
      return mod.default({ locateFile: wasmUrl });
    })().catch((e) => {
      instancePromise = null;
      throw e;
    });
  }
  return instancePromise;
}

const IN_PATH = "/glim-in.pdf";
const OUT_PATH = "/glim-out.pdf";

// Run qpdf with {in}/{out} placeholders resolved to sandbox paths.
// Always cleans up the Emscripten FS, even on failure.
export async function qpdfProcess(
  input: Uint8Array | ArrayBuffer,
  args: string[]
): Promise<Uint8Array> {
  const qpdf = await loadQpdf();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const resolved = args.map((a) =>
    a === "{in}" ? IN_PATH : a === "{out}" ? OUT_PATH : a
  );
  qpdf.FS.writeFile(IN_PATH, bytes);
  try {
    qpdf.callMain(resolved);
    const out = qpdf.FS.readFile(OUT_PATH, { encoding: "binary" });
    return new Uint8Array(out);
  } finally {
    try {
      qpdf.FS.unlink(IN_PATH);
    } catch {
      /* already gone */
    }
    try {
      qpdf.FS.unlink(OUT_PATH);
    } catch {
      /* never written (qpdf failed) */
    }
  }
}
