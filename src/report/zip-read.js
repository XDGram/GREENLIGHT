// Minimal read-only zip reader for Kane evidence packs (stored and deflated
// entries). Used only to list entries and read small text files (step.json,
// failure.yaml). Anything unexpected throws ZipReadError; callers treat that as
// unreadable evidence.

import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

export class ZipReadError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipReadError";
  }
}

const MAX_ARCHIVE = 100 * 1024 * 1024;
const MAX_ENTRY = 1024 * 1024;

export async function openZip(filePath) {
  const buf = await readFile(filePath);
  if (buf.length > MAX_ARCHIVE) throw new ZipReadError("archive too large");
  if (buf.length < 22) throw new ZipReadError("not a zip archive");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipReadError("end of central directory not found");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > eocd) throw new ZipReadError("central directory out of range");

  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipReadError("bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const read = (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.size > MAX_ENTRY) throw new ZipReadError(`entry too large: ${name}`);
    const lh = e.localOffset;
    if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) throw new ZipReadError(`bad local header: ${name}`);
    const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const data = buf.subarray(start, start + e.compressedSize);
    if (data.length !== e.compressedSize) throw new ZipReadError(`truncated entry: ${name}`);
    if (e.method === 0) return Buffer.from(data);
    if (e.method === 8) {
      const out = inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
      if (out.length !== e.size) throw new ZipReadError(`size mismatch: ${name}`);
      return out;
    }
    throw new ZipReadError(`unsupported compression ${e.method}: ${name}`);
  };

  return { names: [...entries.keys()], has: (n) => entries.has(n), read, readText: (n) => read(n)?.toString("utf8") ?? null };
}
