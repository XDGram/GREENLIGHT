import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** SHA-256 of a file, streamed. Resolves to {sha256, bytes}. */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    let bytes = 0;
    createReadStream(filePath)
      .on("data", (c) => {
        h.update(c);
        bytes += c.length;
      })
      .on("error", reject)
      .on("end", () => resolve({ sha256: h.digest("hex"), bytes }));
  });
}

export function sha256Bytes(data) {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Deterministic JSON: object keys sorted, no whitespace. Used for the run
 * record hash so the same record always hashes the same.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
    if (value === undefined) return "null";
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}
