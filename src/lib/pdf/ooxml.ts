// Minimal OOXML (.docx/.xlsx) writer with zero dependencies.
// Deflates with the browser-native CompressionStream when available and
// falls back to stored (uncompressed) entries otherwise — both are valid ZIP.

export function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const CS = (globalThis as unknown as {
      CompressionStream?: new (format: string) => {
        readable: ReadableStream;
        writable: WritableStream;
      };
    }).CompressionStream;
    if (!CS) return null;
    const cs = new CS("deflate-raw");
    const out: BlobPart[] = [];
    const reader = cs.readable.getReader();
    const writer = cs.writable.getWriter();
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.push(value);
      }
    })();
    await writer.write(data as unknown as ArrayBuffer);
    await writer.close();
    await pump;
    const blob = new Blob(out);
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

// Fixed DOS timestamp (2024-01-01) keeps output deterministic.
const DOS_TIME = (10 << 11) | (0 << 5) | 0; // 10:00:00
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

export async function buildZip(entries: ZipEntry[]): Promise<Blob> {
  const enc = new TextEncoder();
  const chunks: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;

  for (const e of entries) {
    const raw = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const deflated = await deflateRaw(raw);
    const method = deflated ? 8 : 0;
    const body = deflated ?? raw;
    const nameBytes = enc.encode(e.name);
    const crc = crc32(raw);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 filenames
    local.setUint16(8, method, true);
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    chunks.push(local.buffer as ArrayBuffer, nameBytes, body as unknown as BlobPart);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, method, true);
    cen.setUint16(12, DOS_TIME, true);
    cen.setUint16(14, DOS_DATE, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, body.length, true);
    cen.setUint32(24, raw.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint16(30, 0, true);
    cen.setUint16(32, 0, true);
    cen.setUint16(34, 0, true);
    cen.setUint16(36, 0, true);
    cen.setUint32(38, 0, true);
    cen.setUint32(42, offset, true);
    central.push(cen.buffer as ArrayBuffer, nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }

  const centralSize = central.reduce(
    (n, c) => n + (c instanceof ArrayBuffer ? c.byteLength : (c as Uint8Array).length),
    0
  );
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  return new Blob([...chunks, ...central, end.buffer as ArrayBuffer], {
    type: "application/zip",
  });
}
