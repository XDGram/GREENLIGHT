// Cheap structural check that a file looks like a complete zip archive.
// Kane evidence packs are standard zip files. This catches empty, truncated
// and non-zip files before they are copied or handed to the validator. It is
// not a substitute for `kane-cli evidence validate`.

import { open } from "node:fs/promises";

const LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\3\4
const END_OF_CENTRAL_DIR = Buffer.from([0x50, 0x4b, 0x05, 0x06]); // PK\5\6
const EOCD_MIN = 22;
const EOCD_MAX_SEARCH = EOCD_MIN + 0xffff; // record + maximum comment length

/** @returns {Promise<{ok: boolean, reason: string|null}>} */
export async function checkZipStructure(filePath) {
  const fh = await open(filePath, "r");
  try {
    const { size } = await fh.stat();
    if (size < EOCD_MIN + LOCAL_HEADER.length) return { ok: false, reason: "too_small" };
    const head = Buffer.alloc(4);
    await fh.read(head, 0, 4, 0);
    if (!head.equals(LOCAL_HEADER)) return { ok: false, reason: "not_a_zip" };
    const tailLen = Math.min(size, EOCD_MAX_SEARCH);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    const at = tail.lastIndexOf(END_OF_CENTRAL_DIR);
    if (at === -1 || tailLen - at < EOCD_MIN) return { ok: false, reason: "no_end_of_central_directory" };
    // The central directory it points to must lie inside the file.
    const cdSize = tail.readUInt32LE(at + 12);
    const cdOffset = tail.readUInt32LE(at + 16);
    const eocdOffset = size - tailLen + at;
    if (cdOffset + cdSize > eocdOffset) return { ok: false, reason: "central_directory_out_of_range" };
    return { ok: true, reason: null };
  } finally {
    await fh.close();
  }
}
