import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { globalDir, readSession, writeSession } from "../src/remote/session.js";

const homes: string[] = [];
afterEach(() => {
  for (const path of homes.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function home() {
  const path = mkdtempSync(join(tmpdir(), "pmcp-home-"));
  homes.push(path);
  return path;
}
const session = {
  issuer: "https://auth.pmcp.build/",
  accessToken: "access-token-value",
};
const mode = (path: string) => (statSync(path).mode & 0o777).toString(8);

it("narrows a session file that already exists at a looser mode", () => {
  const root = home();
  const directory = globalDir(root);
  const file = join(directory, "session.json");
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, "{}");
  chmodSync(file, 0o644);
  writeSession(session, root);
  expect(mode(file)).toBe("600");
  expect(readSession(root)).toMatchObject({
    accessToken: "access-token-value",
  });
});

it("creates the session directory and file closed to other users", () => {
  const root = home();
  writeSession(session, root);
  expect(mode(globalDir(root))).toBe("700");
  expect(mode(join(globalDir(root), "session.json"))).toBe("600");
});

it("narrows a session directory that already exists group-writable", () => {
  // Measured on this host at 0775, so it is a state rather than a hypothesis.
  // A private file inside a group-writable directory is still replaceable by
  // anyone in the group, who never has to read it to substitute their own.
  const root = home();
  const directory = globalDir(root);
  mkdirSync(directory, { recursive: true });
  chmodSync(directory, 0o775);
  writeSession(session, root);
  expect(mode(directory)).toBe("700");
});
