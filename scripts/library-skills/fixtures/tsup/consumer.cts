import assert = require("node:assert/strict");
import library = require("pmcp-tsup-fixture-library");

const result: library.DigestResult = library.digest("abc");
assert.equal(result.algorithm, "sha256");
assert.equal(
  result.value,
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);
