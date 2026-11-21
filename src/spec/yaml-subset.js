// Strict YAML-subset parser for greenlight.yaml. No dependencies.
//
// Supported:
//   - block mappings (`key: value`) and block sequences (`- item`), space indentation
//   - sequences under a key at the same indent as the key (`claims:\n- id: ...`)
//   - scalars: plain, 'single-quoted', "double-quoted" (JSON escapes)
//   - plain scalars: integers -> number, true/false -> boolean, null/~ -> null, else string
//   - flow sequences of scalars: [a, "b", 3]
//   - block scalars: | and > with optional - or + chomping
//   - comments (# at line start or after whitespace, outside quotes)
//   - one optional leading `---`
// Rejected with a line number: tabs, anchors (&), aliases (*), tags (!), flow
// mappings ({}), complex keys (?), duplicate keys, multiple documents, directives.

export class YamlSubsetError extends Error {
  constructor(message, line) {
    super(line ? `line ${line}: ${message}` : message);
    this.name = "YamlSubsetError";
    this.line = line ?? null;
  }
}

const INT = /^-?(?:0|[1-9]\d*)$/;
const KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === "\\") i++;
      else if (c === quote) {
        if (quote === "'" && text[i + 1] === "'") i++;
        else quote = null;
      }
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s\[,:-]/.test(text[i - 1])) quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i);
    }
  }
  return text;
}

export function parseYamlSubset(source) {
  if (typeof source !== "string") throw new YamlSubsetError("input must be a string");
  const raw = source.replace(/^﻿/, "").split(/\r?\n/);
  const lines = raw.map((text, idx) => {
    if (/^\s*\t/.test(text) || /^ *\t/.test(text)) throw new YamlSubsetError("tabs are not allowed for indentation", idx + 1);
    return { no: idx + 1, raw: text };
  });
  const p = new Parser(lines);
  return p.parseDocument();
}

class Parser {
  constructor(lines) {
    this.lines = lines;
    this.i = 0;
  }

  // Next significant line (non-blank after comment removal), without consuming.
  peek() {
    while (this.i < this.lines.length) {
      const l = this.lines[this.i];
      const content = stripComment(l.raw);
      if (content.trim() === "") {
        this.i++;
        continue;
      }
      const indent = content.length - content.trimStart().length;
      return { ...l, indent, text: content.trimEnd().slice(indent) };
    }
    return null;
  }

  parseDocument() {
    let first = this.peek();
    if (first && first.indent === 0 && first.text === "---") {
      this.i++;
      first = this.peek();
    }
    if (!first) throw new YamlSubsetError("document is empty");
    if (first.indent !== 0) throw new YamlSubsetError("document must start at column 0", first.no);
    const value = this.parseBlock(0);
    const rest = this.peek();
    if (rest) {
      if (rest.text === "---" || rest.text === "...") throw new YamlSubsetError("multiple documents are not supported", rest.no);
      throw new YamlSubsetError("unexpected content (check indentation)", rest.no);
    }
    return value;
  }

  parseBlock(indent) {
    const l = this.peek();
    if (!l || l.indent < indent) return null;
    if (l.text.startsWith("%")) throw new YamlSubsetError("directives are not supported", l.no);
    if (isSeqItem(l.text)) return this.parseSeq(l.indent);
    return this.parseMap(l.indent);
  }

  parseMap(indent) {
    const out = Object.create(null);
    const keys = new Set();
    for (;;) {
      const l = this.peek();
      if (!l || l.indent < indent) break;
      if (l.indent > indent) throw new YamlSubsetError("unexpected indentation", l.no);
      if (isSeqItem(l.text)) break;
      if (l.text === "---" || l.text === "...") throw new YamlSubsetError("multiple documents are not supported", l.no);
      const { key, rest } = splitKey(l);
      if (keys.has(key)) throw new YamlSubsetError(`duplicate key "${key}"`, l.no);
      keys.add(key);
      this.i++;
      out[key] = this.parseValue(rest, indent, l, true);
    }
    return { ...out };
  }

  parseSeq(indent) {
    const out = [];
    for (;;) {
      const l = this.peek();
      if (!l || l.indent < indent) break;
      if (l.indent > indent) throw new YamlSubsetError("unexpected indentation", l.no);
      if (!isSeqItem(l.text)) break;
      const after = l.text.slice(1);
      const content = after.trimStart();
      const col = indent + 1 + (after.length - content.length);
      if (content === "") {
        this.i++;
        const child = this.peek();
        if (!child || child.indent <= indent) out.push(null);
        else out.push(this.parseBlock(child.indent));
        continue;
      }
      if (looksLikeMapEntry(content)) {
        // Re-read this line as the first entry of a mapping starting at `col`.
        this.lines[this.i] = { no: l.no, raw: " ".repeat(col) + content };
        out.push(this.parseMap(col));
        continue;
      }
      if (isSeqItem(content)) throw new YamlSubsetError("nested sequences on one line are not supported", l.no);
      this.i++;
      out.push(this.parseValue(content, indent, l, false));
    }
    return out;
  }

  // Value after `key:` or `- `. `parentIndent` is the indent of the owning line.
  parseValue(rest, parentIndent, line, inMap) {
    if (rest === "") {
      const next = this.peek();
      if (!next) return null;
      if (next.indent > parentIndent) return this.parseBlock(next.indent);
      if (inMap && next.indent === parentIndent && isSeqItem(next.text)) return this.parseSeq(parentIndent);
      return null;
    }
    if (/^[|>][+-]?$/.test(rest)) return this.parseBlockScalar(rest, parentIndent, line);
    const v = parseInlineScalar(rest, line.no);
    const next = this.peek();
    if (next && next.indent > parentIndent) {
      throw new YamlSubsetError("unexpected indentation after a value (multi-line plain values are not supported; use | or >)", next.no);
    }
    return v;
  }

  parseBlockScalar(header, parentIndent, line) {
    const style = header[0];
    const chomp = header[1] ?? "";
    const collected = [];
    let contentIndent = null;
    while (this.i < this.lines.length) {
      const raw = this.lines[this.i].raw;
      if (raw.trim() === "") {
        collected.push("");
        this.i++;
        continue;
      }
      const ind = raw.length - raw.trimStart().length;
      if (ind <= parentIndent) break;
      if (contentIndent === null) contentIndent = ind;
      if (ind < contentIndent) throw new YamlSubsetError("block scalar line is less indented than its first line", this.lines[this.i].no);
      collected.push(raw.slice(contentIndent));
      this.i++;
    }
    // Trailing blank lines belong to chomping, not content.
    let trailing = 0;
    while (collected.length && collected[collected.length - 1] === "") {
      collected.pop();
      trailing++;
    }
    if (collected.length === 0) throw new YamlSubsetError("empty block scalar", line.no);
    let body;
    if (style === "|") body = collected.join("\n");
    else {
      body = "";
      for (let k = 0; k < collected.length; k++) {
        const cur = collected[k];
        if (k === 0) body = cur;
        else if (cur === "") body += "\n";
        else body += body.endsWith("\n") ? cur : ` ${cur}`;
      }
    }
    if (chomp === "-") return body;
    if (chomp === "+") return body + "\n".repeat(trailing + 1);
    return body + "\n";
  }
}

function isSeqItem(text) {
  return text === "-" || text.startsWith("- ");
}

function looksLikeMapEntry(content) {
  if (content.startsWith('"') || content.startsWith("'")) {
    const q = content[0];
    const end = content.indexOf(q, 1);
    return end > 0 && content.slice(end + 1).trimStart().startsWith(":");
  }
  return /^[^\s\[\]{}#&*!|>'"%@`,][^:]*:(?:\s|$)/.test(content);
}

function splitKey(l) {
  const t = l.text;
  let key;
  let rest;
  if (t.startsWith('"') || t.startsWith("'")) {
    const parsed = readQuoted(t, 0, l.no);
    key = parsed.value;
    const after = t.slice(parsed.end).trimStart();
    if (!after.startsWith(":")) throw new YamlSubsetError("expected ':' after quoted key", l.no);
    rest = after.slice(1);
  } else {
    if (t.startsWith("?")) throw new YamlSubsetError("complex keys are not supported", l.no);
    const m = /^([^:]*?)\s*:(?:\s|$)/.exec(t);
    if (!m) throw new YamlSubsetError(`expected "key: value", got "${t}"`, l.no);
    key = m[1];
    rest = t.slice(m[0].length);
    if (!KEY.test(key)) throw new YamlSubsetError(`invalid key "${key}"`, l.no);
  }
  return { key, rest: rest.trim() };
}

function readQuoted(text, start, lineNo) {
  const q = text[start];
  let i = start + 1;
  let out = "";
  if (q === "'") {
    for (; i < text.length; i++) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i++;
        } else return { value: out, end: i + 1 };
      } else out += text[i];
    }
  } else {
    for (; i < text.length; i++) {
      if (text[i] === "\\") {
        i++;
        const e = text[i];
        const map = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", 0: "\0" };
        if (e === "u") {
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new YamlSubsetError("invalid \\u escape", lineNo);
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else if (e in map) out += map[e];
        else throw new YamlSubsetError(`invalid escape \\${e ?? ""}`, lineNo);
      } else if (text[i] === '"') return { value: out, end: i + 1 };
      else out += text[i];
    }
  }
  throw new YamlSubsetError("unterminated quoted string", lineNo);
}

function parseInlineScalar(text, lineNo) {
  const c = text[0];
  if (c === '"' || c === "'") {
    const r = readQuoted(text, 0, lineNo);
    if (text.slice(r.end).trim() !== "") throw new YamlSubsetError("unexpected text after quoted string", lineNo);
    return r.value;
  }
  if (c === "[") return parseFlowSeq(text, lineNo);
  if (c === "{") throw new YamlSubsetError("flow mappings ({...}) are not supported", lineNo);
  if (c === "&") throw new YamlSubsetError("anchors are not supported", lineNo);
  if (c === "*") throw new YamlSubsetError("aliases are not supported", lineNo);
  if (c === "!") throw new YamlSubsetError("tags are not supported", lineNo);
  if (c === "@" || c === "`" || c === "%") throw new YamlSubsetError(`a plain value cannot start with "${c}"`, lineNo);
  if (/:\s/.test(text) || text.endsWith(":")) throw new YamlSubsetError(`ambiguous value "${text}" (quote it)`, lineNo);
  return plainScalar(text.trim());
}

function plainScalar(s) {
  if (s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (INT.test(s)) {
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
  }
  return s;
}

function parseFlowSeq(text, lineNo) {
  if (!text.endsWith("]")) throw new YamlSubsetError("unterminated flow sequence", lineNo);
  const inner = text.slice(1, -1).trim();
  if (inner === "") return [];
  const items = [];
  let i = 0;
  while (i < inner.length) {
    while (inner[i] === " ") i++;
    let value;
    if (inner[i] === '"' || inner[i] === "'") {
      const r = readQuoted(inner, i, lineNo);
      value = r.value;
      i = r.end;
    } else {
      let j = i;
      while (j < inner.length && inner[j] !== ",") j++;
      const token = inner.slice(i, j).trim();
      if (token === "") throw new YamlSubsetError("empty item in flow sequence", lineNo);
      if (/[\[\]{}]/.test(token)) throw new YamlSubsetError("nested flow collections are not supported", lineNo);
      if (/^[&*!]/.test(token)) throw new YamlSubsetError("anchors, aliases and tags are not supported", lineNo);
      value = plainScalar(token);
      i = j;
    }
    items.push(value);
    while (inner[i] === " ") i++;
    if (i < inner.length) {
      if (inner[i] !== ",") throw new YamlSubsetError("expected ',' in flow sequence", lineNo);
      i++;
      if (inner.slice(i).trim() === "") throw new YamlSubsetError("trailing comma in flow sequence", lineNo);
    }
  }
  return items;
}
