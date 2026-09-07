#!/usr/bin/env node
// The one-click install links, generated rather than hand-written: the two
// editors encode the same config differently, and a hand-typed base64 payload
// fails silently by opening an editor with nothing configured.

const NAME = "pmcp";

// What each editor writes into its own MCP config. Kept identical across the
// two so a user gets the same server whichever badge they press.
const CONFIG = {
  type: "stdio",
  command: "npx",
  args: ["-y", "pmcp"],
};

const json = JSON.stringify(CONFIG);

const cursor = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(
  NAME,
)}&config=${Buffer.from(json, "utf8").toString("base64")}`;

const vscode = `vscode://mcp/install?name=${encodeURIComponent(
  NAME,
)}&config=${encodeURIComponent(json)}`;

const vscodeInsiders = vscode.replace("vscode://", "vscode-insiders://");

const badge = (label, colour, logo, href) =>
  `[![Add to ${label}](https://img.shields.io/badge/Add_to_${label.replace(/ /gu, "_")}-${colour}?style=for-the-badge&logo=${logo}&logoColor=white)](${href})`;

const rows = [
  ["Cursor", "black", "cursor", cursor],
  ["VS Code", "007ACC", "visualstudiocode", vscode],
  ["VS Code Insiders", "24bfa5", "visualstudiocode", vscodeInsiders],
];

if (process.argv.includes("--json")) {
  process.stdout.write(
    `${JSON.stringify({ config: CONFIG, links: Object.fromEntries(rows.map(([l, , , h]) => [l, h])) }, null, 2)}\n`,
  );
} else {
  for (const [label, colour, logo, href] of rows) {
    process.stdout.write(`${badge(label, colour, logo, href)}\n`);
  }
}

// The payload has to survive the round trip, or the badge opens an editor with
// an empty form and the failure looks like the editor's.
const decoded = JSON.parse(
  Buffer.from(
    new URL(cursor).searchParams.get("config") ?? "",
    "base64",
  ).toString("utf8"),
);
if (JSON.stringify(decoded) !== json) {
  process.stderr.write("install-links: cursor payload does not round-trip\n");
  process.exit(1);
}
const decodedVscode = JSON.parse(
  new URL(vscode).searchParams.get("config") ?? "",
);
if (JSON.stringify(decodedVscode) !== json) {
  process.stderr.write("install-links: vscode payload does not round-trip\n");
  process.exit(1);
}
