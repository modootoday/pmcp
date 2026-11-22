import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { codexMailboxRoots } from "../../src/sessions/mailbox/codex-access.js";
import { projectStateDir } from "../../src/sessions/state-dir.js";

let base: string;
let desk: string;
let config: string;
let env: Record<string, string>;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "pmcp-mailbox-access-"));
  desk = join(base, "desk");
  await mkdir(desk);
  config = join(desk, "pmcp.toml");
  env = { XDG_STATE_HOME: join(base, "state") };
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

it("grants only the enabled mailbox paths in the configured project state", async () => {
  await writeFile(
    config,
    "[sessions]\nstate_dir = '../custom'\n[sessions.mailbox]\n",
  );
  const state = join(base, "custom");
  await mkdir(state);
  const audit = join(state, "messages.jsonl");
  await writeFile(audit, "existing\n", { mode: 0o600 });
  const before = await stat(audit);
  const roots = await codexMailboxRoots(desk, env);
  expect(roots).toEqual([join(state, "messages"), join(state, "inbox")]);
  expect((await lstat(audit)).isSymbolicLink()).toBe(true);
  expect((await stat(audit)).ino).toBe(before.ino);
  await appendFile(audit, "new\n");
  expect(await readFile(join(state, "messages", ".audit.jsonl"), "utf8")).toBe(
    "existing\nnew\n",
  );
  expect(await codexMailboxRoots(desk, env)).toEqual(roots);
});

it("leaves disabled mailboxes untouched and omits disabled audit access", async () => {
  await writeFile(config, "[sessions.mailbox]\nenabled = false\n");
  const state = projectStateDir(desk, undefined, env);
  expect(await codexMailboxRoots(desk, env)).toEqual([]);
  await expect(lstat(state)).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(config, "[sessions.mailbox]\naudit = false\n");
  expect(await codexMailboxRoots(desk, env)).toEqual([
    join(state, "messages"),
    join(state, "inbox"),
  ]);
  await expect(lstat(join(state, "messages.jsonl"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("rejects a mailbox directory redirected outside project state", async () => {
  await writeFile(config, "[sessions.mailbox]\n");
  const state = projectStateDir(desk, undefined, env);
  await mkdir(state, { recursive: true });
  await symlink(desk, join(state, "messages"));
  await expect(codexMailboxRoots(desk, env)).rejects.toThrow(
    "unsafe mailbox directory",
  );
});
