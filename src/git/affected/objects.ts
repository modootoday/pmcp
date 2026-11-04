import { gitBytes } from "../exec.js";

export interface Entry {
  readonly mode: string;
  readonly oid: string;
}

const LINK_MODE = "120000";
const GITLINK_MODE = "160000";

export function isLink(entry: Entry): boolean {
  return entry.mode === LINK_MODE;
}

// One repository's tree at a commit, listed from its object store and never from a checkout.
export class RepoTree {
  readonly files = new Map<string, Entry>();
  readonly gitlinks = new Map<string, string>();
  private dirIndex: Map<string, string[]> | undefined;

  private constructor(readonly gitDir: string) {}

  static read(gitDir: string, commit: string): RepoTree {
    const run = gitBytes(gitDir, [
      `--git-dir=${gitDir}`,
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      commit,
    ]);
    if (run.status !== 0)
      throw new Error(`cannot list ${commit}: ${run.stderr.trim()}`);
    const tree = new RepoTree(gitDir);
    for (const record of run.stdout.toString("utf8").split("\0")) {
      const tab = record.indexOf("\t");
      if (tab < 0) continue;
      const [mode, , oid] = record.slice(0, tab).split(" ");
      const path = record.slice(tab + 1);
      if (mode === GITLINK_MODE) tree.gitlinks.set(path, oid!);
      else tree.files.set(path, { mode: mode!, oid: oid! });
    }
    return tree;
  }

  // File names directly inside dir ("" for the top).
  children(dir: string): readonly string[] {
    if (this.dirIndex === undefined) {
      this.dirIndex = new Map();
      for (const path of this.files.keys()) {
        const slash = path.lastIndexOf("/");
        const parent = slash < 0 ? "" : path.slice(0, slash);
        const list = this.dirIndex.get(parent) ?? [];
        list.push(path.slice(slash + 1));
        this.dirIndex.set(parent, list);
      }
    }
    return this.dirIndex.get(dir) ?? [];
  }

  // Blob texts by object id in one cat-file process; a missing object is left out.
  blobs(oids: Iterable<string>): Map<string, string> {
    const out = new Map<string, string>();
    const wanted = [...new Set(oids)];
    if (wanted.length === 0) return out;
    const run = gitBytes(
      this.gitDir,
      [`--git-dir=${this.gitDir}`, "cat-file", "--batch"],
      wanted.join("\n") + "\n",
    );
    if (run.status !== 0)
      throw new Error(`cannot read objects: ${run.stderr.trim()}`);
    const bytes = run.stdout;
    let at = 0;
    while (at < bytes.length) {
      const eol = bytes.indexOf(0x0a, at);
      if (eol < 0) break;
      const [oid, type, size] = bytes.toString("utf8", at, eol).split(" ");
      at = eol + 1;
      if (type === "missing" || size === undefined) continue;
      const end = at + Number(size);
      if (type === "blob") out.set(oid!, bytes.toString("utf8", at, end));
      at = end + 1;
    }
    return out;
  }
}
