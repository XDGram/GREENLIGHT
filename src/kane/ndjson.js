// Incremental NDJSON decoder for Kane CLI `--agent` output.
//
// Kane writes one JSON object per line on stdout. Chunks from a child process
// can split a line, or a multi-byte UTF-8 character, at any byte. This decoder
// buffers until a newline, then hands each complete line to a callback.
//
// Rules (from the Kane 0.10.6 stream contract, verified in Runs 1-2):
// - Skip any line that is not a JSON object; never throw on it.
// - Blank lines are ignored.
// - A final line without a trailing newline is still parsed on end().

import { StringDecoder } from "node:string_decoder";

export class NdjsonDecoder {
  /**
   * @param {object} handlers
   * @param {(event: object, lineNumber: number) => void} [handlers.onEvent]
   * @param {(line: string, lineNumber: number, reason: string) => void} [handlers.onNonJson]
   */
  constructor({ onEvent = () => {}, onNonJson = () => {} } = {}) {
    this.onEvent = onEvent;
    this.onNonJson = onNonJson;
    this.decoder = new StringDecoder("utf8");
    this.buffer = "";
    this.lineNumber = 0;
    this.ended = false;
  }

  /** @param {Buffer|string} chunk */
  push(chunk) {
    if (this.ended) throw new Error("NdjsonDecoder: push() after end()");
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    let newline;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.#handleLine(line);
    }
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.buffer += this.decoder.end();
    if (this.buffer.length > 0) {
      const line = this.buffer;
      this.buffer = "";
      this.#handleLine(line);
    }
  }

  #handleLine(rawLine) {
    this.lineNumber += 1;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") return;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      this.onNonJson(line, this.lineNumber, "invalid_json");
      return;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      this.onNonJson(line, this.lineNumber, "not_an_object");
      return;
    }
    this.onEvent(value, this.lineNumber);
  }
}
