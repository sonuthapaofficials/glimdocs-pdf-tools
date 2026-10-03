// Minimal OOXML ZIP reader with zero dependencies: parses the central
// directory, inflates deflated entries (browser DecompressionStream with a
// Node zlib fallback), and returns raw entry bytes. Used by the Word and
// Excel importers. Only supports methods 0 (stored) and 8 (deflated);
// entries using data descriptors are skipped (Office never emits those).

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (
    globalThis as unknown as {
      DecompressionStream?: new (format: string) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }
  ).DecompressionStream;
  if (DS) {
    const ds = new DS("deflate-raw");
    const chunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    const writer = ds.writable.getWriter();
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    })();
    await writer.write(data);
    await writer.close();
    await pump;
    // Concat into one ArrayBuffer-backed view (BlobPart rejects ArrayBufferLike).
    let total = 0;
    for (const c of chunks) total += c.length;
    const combined = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      combined.set(c, off);
      off += c.length;
    }
    return combined;
  }
  const zlib = await import(/* webpackIgnore: true */ "node:zlib");
  const buf = zlib.inflateRawSync(Buffer.from(data));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function u16(dv: DataView, off: number): number {
  return dv.getUint16(off, true);
}

function u32(dv: DataView, off: number): number {
  return dv.getUint32(off, true);
}

export async function unzipFiles(
  data: Uint8Array
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) return out;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Locate End-Of-Central-Directory by scanning backwards for its signature.
  let eocd = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return out;
  const count = u16(dv, eocd + 10);
  const cdOff = u32(dv, eocd + 16);
  const dec = new TextDecoder();
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length) break;
    if (u32(dv, p) !== 0x02014b50) break;
    const flags = u16(dv, p + 8);
    const method = u16(dv, p + 10);
    const compSize = u32(dv, p + 20);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commentLen = u16(dv, p + 32);
    const localOff = u32(dv, p + 42);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith("/")) continue;
    if (flags & 0x08) continue; // data descriptor: sizes unknown, skip
    if (localOff + 30 > data.length) continue;
    if (u32(dv, localOff) !== 0x04034b50) continue;
    const lhNameLen = u16(dv, localOff + 26);
    const lhExtraLen = u16(dv, localOff + 28);
    const bodyOff = localOff + 30 + lhNameLen + lhExtraLen;
    if (bodyOff + compSize > data.length) continue;
    const body = data.subarray(bodyOff, bodyOff + compSize);
    try {
      out.set(name, method === 8 ? await inflateRaw(body) : body.slice());
    } catch {
      // Corrupt entry: skip, keep the rest of the archive readable.
    }
  }
  return out;
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function xmlUnescape(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n: string) => {
      try {
        return String.fromCodePoint(parseInt(n, 10));
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return "";
      }
    });
}
