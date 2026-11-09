import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The operator as tests act it: a private token file outside the project, and the matching
// PMCP_OPERATOR_TOKEN, since a test run has no interactive terminal.
export function operatorToken(base = mkdtempSync(join(tmpdir(), "pmcp-op-"))) {
  const dir = join(base, "operator");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "token");
  writeFileSync(file, "operator-secret\n", { mode: 0o600 });
  return {
    toml: `[sessions.operator]\nvia = "token"\ntoken_file = "${file}"\n`,
    env: { PMCP_OPERATOR_TOKEN: "operator-secret" },
  };
}
