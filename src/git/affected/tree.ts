import { existsSync } from "node:fs";
import { join, posix, resolve } from "node:path";

import { gitText } from "../exec.js";
import { isLink, RepoTree, type Entry } from "./objects.js";

interface Mount {
  readonly prefix: string;
  readonly repo: RepoTree;
  // Git directories whose modules/ may hold this repository's submodules.
  readonly stores: readonly string[];
}

interface Found {
  readonly mount: Mount;
  readonly rel: string;
}

function submoduleNames(text: string | null): Map<string, string> {
  const names = new Map<string, string>();
  let name: string | undefined;
  for (const line of (text ?? "").split("\n")) {
    const header = /^\s*\[submodule\s+"(.+)"\]\s*$/u.exec(line);
    if (header) name = header[1];
    const path = /^\s*path\s*=\s*(.+?)\s*$/u.exec(line);
    if (path && name !== undefined) names.set(path[1]!, name);
  }
  return names;
}

// A revision's files across the repository and the submodules it pins, read from object
// stores only, so a checkout that moves meanwhile cannot change the answer.
export class HeadTree {
  private readonly mounts = new Map<string, Mount | null>();
  private readonly texts = new Map<string, string | null>();

  private constructor(
    private readonly root: string,
    top: Mount,
  ) {
    this.mounts.set("", top);
  }

  static open(root: string, rev: string): HeadTree {
    const [gitDir, common] = gitText(root, [
      "rev-parse",
      "--absolute-git-dir",
      "--git-common-dir",
    ]).split("\n");
    if (!gitDir || !common) throw new Error(`${root} has no git directory`);
    const stores = [gitDir, resolve(root, common)];
    return new HeadTree(root, {
      prefix: "",
      repo: RepoTree.read(gitDir, rev),
      stores,
    });
  }

  // The checkout's own pointer is asked last, as a store a moved checkout may still name.
  private *stores(parent: Mount, rel: string): Generator<string> {
    const name = submoduleNames(this.read(parent, ".gitmodules")).get(rel);
    const seen = new Set<string>();
    for (const store of parent.stores) {
      const dir = join(store, "modules", name ?? rel);
      if (!seen.has(dir) && existsSync(dir)) yield dir;
      seen.add(dir);
    }
    const pointer = gitText(join(this.root, parent.prefix, rel), [
      "rev-parse",
      "--absolute-git-dir",
    ]);
    if (pointer && !seen.has(pointer) && !parent.stores.includes(pointer))
      yield pointer;
  }

  // A submodule no store holds reads as empty, as an uninitialized one does; a store that
  // lacks the pinned commit fails, since the answer would be for another revision.
  private mount(parent: Mount, rel: string): Mount | null {
    const prefix = `${parent.prefix}${rel}/`;
    const known = this.mounts.get(prefix);
    if (known !== undefined) return known;
    const commit = parent.repo.gitlinks.get(rel)!;
    let failure: Error | undefined;
    let mount: Mount | null = null;
    for (const store of this.stores(parent, rel)) {
      try {
        mount = { prefix, repo: RepoTree.read(store, commit), stores: [store] };
        break;
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (mount === null && failure !== undefined)
      throw new Error(`submodule ${prefix.slice(0, -1)}: ${failure.message}`);
    this.mounts.set(prefix, mount);
    return mount;
  }

  // The repository holding path, descending through the gitlinks above it.
  private find(path: string): Found | null {
    let mount = this.mounts.get("")!;
    let rel = path;
    for (;;) {
      if (mount.repo.gitlinks.has(rel)) return { mount, rel };
      let link: string | undefined;
      for (
        let dir = posix.dirname(rel);
        dir !== "." && dir !== "/" && link === undefined;
        dir = posix.dirname(dir)
      )
        if (mount.repo.gitlinks.has(dir)) link = dir;
      if (link === undefined) return { mount, rel };
      const inner = this.mount(mount, link);
      if (inner === null) return null;
      mount = inner;
      rel = rel.slice(link.length + 1);
    }
  }

  private entry(path: string): (Found & { entry: Entry }) | null {
    const found = this.find(path);
    const entry = found?.mount.repo.files.get(found.rel);
    return found && entry ? { ...found, entry } : null;
  }

  private read(mount: Mount, rel: string): string | null {
    const path = mount.prefix + rel;
    if (!this.texts.has(path)) this.prefetch([path]);
    return this.texts.get(path) ?? null;
  }

  // A symbolic link resolves inside the tree, as the checkout would follow it.
  private linkTarget(path: string): string | null {
    if (!this.texts.has(path)) this.prefetch([path]);
    const text = this.texts.get(path) ?? null;
    if (text === null) return null;
    const next = posix.normalize(posix.join(posix.dirname(path), text));
    return next.startsWith("..") || posix.isAbsolute(next) ? null : next;
  }

  has(path: string, hops = 8): boolean {
    const found = this.entry(path);
    if (found === null) return false;
    if (!isLink(found.entry)) return true;
    const next = hops > 0 ? this.linkTarget(path) : null;
    return next !== null && this.has(next, hops - 1);
  }

  text(path: string, hops = 8): string | null {
    const found = this.entry(path);
    if (found === null) return null;
    if (isLink(found.entry)) {
      const next = hops > 0 ? this.linkTarget(path) : null;
      return next === null ? null : this.text(next, hops - 1);
    }
    if (!this.texts.has(path)) this.prefetch([path]);
    return this.texts.get(path) ?? null;
  }

  // Reads every named file in one object-store pass per repository.
  prefetch(paths: Iterable<string>): void {
    const byRepo = new Map<RepoTree, Map<string, string[]>>();
    for (const path of paths) {
      if (this.texts.has(path)) continue;
      const found = this.entry(path);
      if (found === null) {
        this.texts.set(path, null);
        continue;
      }
      const oids = byRepo.get(found.mount.repo) ?? new Map<string, string[]>();
      oids.set(found.entry.oid, [...(oids.get(found.entry.oid) ?? []), path]);
      byRepo.set(found.mount.repo, oids);
    }
    for (const [repo, oids] of byRepo) {
      const blobs = repo.blobs(oids.keys());
      for (const [oid, list] of oids)
        for (const path of list) this.texts.set(path, blobs.get(oid) ?? null);
    }
  }

  // File names directly inside dir.
  children(dir: string): readonly string[] {
    const found = this.find(dir);
    if (found === null) return [];
    if (found.mount.repo.gitlinks.has(found.rel)) {
      const inner = this.mount(found.mount, found.rel);
      return inner === null ? [] : inner.repo.children("");
    }
    return found.mount.repo.children(found.rel);
  }

  // Every file below prefix ("" for all), entering a submodule only when descend allows it.
  files(
    prefix: string,
    descend: (gitlink: string) => boolean = () => true,
  ): string[] {
    const out: string[] = [];
    const visit = (mount: Mount): void => {
      for (const rel of mount.repo.files.keys()) {
        const path = mount.prefix + rel;
        if (path.startsWith(prefix)) out.push(path);
      }
      for (const rel of mount.repo.gitlinks.keys()) {
        const path = mount.prefix + rel;
        const related =
          path.startsWith(prefix) || prefix.startsWith(`${path}/`);
        if (!related || !descend(path)) continue;
        const inner = this.mount(mount, rel);
        if (inner !== null) visit(inner);
      }
    };
    visit(this.mounts.get("")!);
    return out;
  }
}
