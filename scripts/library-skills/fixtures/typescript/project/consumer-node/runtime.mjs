import assert from "node:assert/strict";
import { scale } from "@pmcp-fixture/typed-library";

assert.equal(scale(4, { factor: 3 }), 12);
