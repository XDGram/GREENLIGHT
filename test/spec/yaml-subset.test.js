import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYamlSubset, YamlSubsetError } from "../../src/spec/yaml-subset.js";

test("mappings, sequences, quoting, flow lists, comments, block scalars", () => {
  const doc = parseYamlSubset(`---
# comment
a: 1
b: "two: # not a comment"   # a comment
c: 'it''s'
d: [x, "y z", 3, true, null]
e:
  - one
  - k: v
    k2: [a]
  -
    nested: yes
f:
- same-indent list
g: |
  line 1
  line 2
h: >-
  folded
  text

  new para
i: ~
j: -7
k: 1.5
l: "\\u00e9\\n"
`);
  assert.deepEqual(doc, {
    a: 1,
    b: "two: # not a comment",
    c: "it's",
    d: ["x", "y z", 3, true, null],
    e: ["one", { k: "v", k2: ["a"] }, { nested: "yes" }],
    f: ["same-indent list"],
    g: "line 1\nline 2\n",
    h: "folded text\nnew para",
    i: null,
    j: -7,
    k: "1.5",
    l: "é\n",
  });
});

test("empty values and an empty flow list", () => {
  assert.deepEqual(parseYamlSubset("a:\nb: []\n"), { a: null, b: [] });
});

for (const [label, src, re] of [
  ["duplicate key", "a: 1\na: 2", /line 2: duplicate key "a"/],
  ["anchor", "a: &x 1", /anchors/],
  ["alias", "a: *x", /aliases/],
  ["tag", "a: !str 1", /tags/],
  ["flow mapping", "a: {b: 1}", /flow mappings/],
  ["tab indentation", "a:\n\tb: 1", /line 2: tabs/],
  ["multiple documents", "a: 1\n---\nb: 2", /multiple documents/],
  ["ambiguous colon", "a: b: c", /ambiguous/],
  ["unterminated flow list", "a: [1, 2", /unterminated flow/],
  ["trailing comma", "a: [1, ]", /trailing comma/],
  ["nested flow", "a: [[1]]", /nested flow/],
  ["multi-line plain value", "a: one\n  two", /line 2: unexpected indentation/],
  ["unterminated quote", 'a: "open', /unterminated quoted/],
  ["bad escape", 'a: "\\q"', /invalid escape/],
  ["bad indentation", "a: 1\n  b: 2", /unexpected indentation/],
  ["complex key", "? a\n: b", /complex keys/],
  ["invalid key", "a b c: 1\nx: [", /invalid key|expected/],
  ["empty document", "# only a comment\n", /empty/],
  ["indented start", "  a: 1", /column 0/],
  ["directive", "%YAML 1.2\na: 1", /directives/],
  ["text after quote", 'a: "x" y', /after quoted/],
  ["empty block scalar", "a: |\nb: 1", /empty block scalar/],
]) {
  test(`rejects: ${label}`, () => {
    assert.throws(() => parseYamlSubset(src), (e) => e instanceof YamlSubsetError && re.test(e.message));
  });
}

test("non-string input is rejected", () => {
  assert.throws(() => parseYamlSubset(42), YamlSubsetError);
});
