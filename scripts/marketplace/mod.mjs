import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";

export const MOD_SOURCE = "src/ui/claude";
export const MOD_OUTPUT = "plugins/pmcp/mod";
// Copy the shared session formats so published mod readers remain compatible with the store.
const SHARED_SOURCE = "src/sessions";
const SHARED_FILES = ["format.ts", "types.ts"];
const SHARED_OUTPUT = `${MOD_OUTPUT}/sessions`;

const SHIPPED = /\.(?:ts|tsx|json)$/u;
const AGENT_FILES = new Set(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
const SPECIFIER = /(from\s+["'])(\.[^"']*)(["'])/gu;

function walk(directory, found) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (AGENT_FILES.has(entry.name)) continue;
    if (lstatSync(path).isSymbolicLink())
      throw new Error(`The Claude mod source cannot contain links: ${path}`);
    if (entry.isDirectory()) {
      walk(path, found);
      continue;
    }
    if (SHIPPED.test(entry.name)) found.push(path);
  }
  return found;
}

function relink(text, sourceFile, outputFile) {
  return text.replace(SPECIFIER, (whole, open, specifier, close) => {
    const target = posix.join(posix.dirname(sourceFile), specifier);
    if (!target.startsWith(`${SHARED_SOURCE}/`)) return whole;
    const shipped = `${SHARED_OUTPUT}/${target.slice(SHARED_SOURCE.length + 1)}`;
    let next = posix.relative(posix.dirname(outputFile), shipped);
    if (!next.startsWith(".")) next = `./${next}`;
    return `${open}${next}${close}`;
  });
}

export function modFiles(root) {
  const source = join(root, MOD_SOURCE);
  if (!existsSync(source))
    throw new Error(`The Claude mod source ${MOD_SOURCE} is missing`);
  const files = new Map();
  for (const path of walk(source, []).sort()) {
    const rel = relative(root, path).split("\\").join("/");
    const output = `${MOD_OUTPUT}/${relative(source, path).split("\\").join("/")}`;
    const bytes = readFileSync(path);
    const text = /\.tsx?$/u.test(path)
      ? relink(bytes.toString("utf8"), rel, output)
      : null;
    files.set(output, text === null ? bytes : Buffer.from(text));
  }
  for (const name of SHARED_FILES)
    files.set(
      `${SHARED_OUTPUT}/${name}`,
      readFileSync(join(root, SHARED_SOURCE, name)),
    );
  if (!files.has(`${MOD_OUTPUT}/hooks.json`))
    throw new Error(`The Claude mod needs ${MOD_SOURCE}/hooks.json`);
  return files;
}
