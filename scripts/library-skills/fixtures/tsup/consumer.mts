import assert from "node:assert/strict";
import { digest, type DigestResult } from "pmcp-tsup-fixture-library";

const result: DigestResult = digest("abc");
assert.equal(result.algorithm, "sha256");
assert.equal(
  result.value,
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);
