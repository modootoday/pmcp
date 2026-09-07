import { createHash } from "node:crypto";
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { readInstalledDependencies } from "../src/installed.js";
import {
  applyInstallPlan,
  createPackageManagerRunner,
} from "../src/install/apply.js";
import { installContext, planInstall } from "../src/install/plan.js";
import { temporaryRegistryConfig } from "../src/remote/distribution.js";
import type { RemoteCatalog } from "../src/remote/catalog.js";

const execute = promisify(execFile);

it("installs pinned skill packages with npm and Bun without executing install hooks", async () => {
  const root = mkdtempSync(join(tmpdir(), "pmcp-registry-"));
  const source = join(root, "skill-source");
  const upstream = join(root, "target");
  const home = join(root, "home");
  let server: ChildProcessWithoutNullStreams | undefined;
  try {
    for (const dir of [source, upstream, home])
      mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(upstream, "package.json"),
      JSON.stringify({ name: "example", version: "2.1.0" }),
    );
    writeFileSync(
      join(source, "package.json"),
      JSON.stringify({
        name: "@pmcp/example",
        version: "1.0.0",
        files: ["skills"],
        scripts: {
          postinstall:
            "node -e \"require('fs').writeFileSync(process.env.PMCP_TEST_MARKER,'unexpected')\"",
        },
      }),
    );
    mkdirSync(join(source, "skills/example"), { recursive: true });
    writeFileSync(
      join(source, "skills/example/SKILL.md"),
      "---\nname: example\ndescription: Use example safely.\n---\n\nInstructions.\n",
    );
    const runtime = await execute(
      "bun",
      ["-e", "process.stdout.write(process.execPath)"],
      { timeout: 15000 },
    );
    const binaries = join(root, "bin");
    mkdirSync(binaries);
    symlinkSync(runtime.stdout.trim(), join(binaries, "bun"));
    const baseEnv = {
      PATH: `${binaries}:${process.env["PATH"] ?? ""}`,
      HOME: home,
      TMPDIR: root,
      npm_config_cache: join(root, "npm-cache"),
      npm_config_userconfig: join(home, ".npmrc"),
      npm_config_globalconfig: join(home, "global-npmrc"),
    };
    const packed = await execute(
      "npm",
      ["pack", "--ignore-scripts", "--json"],
      { cwd: source, env: baseEnv, timeout: 30000 },
    );
    const archivePath = join(source, JSON.parse(packed.stdout)[0].filename);
    const tlsKey = join(root, "registry.key");
    const tlsCert = join(root, "registry.crt");
    await execute(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        tlsKey,
        "-out",
        tlsCert,
        "-subj",
        "/CN=127.0.0.1",
        "-days",
        "1",
      ],
      { timeout: 15000 },
    );
    const archive = readFileSync(archivePath);
    const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    const requestLog = join(root, "registry-requests.jsonl");
    server = spawn(
      process.execPath,
      [join(import.meta.dirname, "fixtures/registry-server.mjs")],
      {
        env: {
          ...process.env,
          ARCHIVE: archivePath,
          TLS_KEY: tlsKey,
          TLS_CERT: tlsCert,
          LOG: requestLog,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = createInterface({ input: server.stdout });
    const [port] = (await once(lines, "line")) as [string];
    lines.close();
    if (!/^[1-9][0-9]*$/u.test(port))
      throw new Error("test registry did not bind");
    const origin = `https://127.0.0.1:${port}`;
    for (const manager of ["npm", "bun"] as const) {
      const project = join(root, manager);
      mkdirSync(join(project, "node_modules"), { recursive: true });
      symlinkSync(upstream, join(project, "node_modules/example"), "dir");
      writeFileSync(
        join(project, "package.json"),
        JSON.stringify({
          name: `fixture-${manager}`,
          version: "1.0.0",
          private: true,
          packageManager: `${manager}@1.0.0`,
          dependencies: { example: "file:../target" },
        }),
      );
      writeFileSync(
        join(project, ".npmrc"),
        `registry=${origin}\n@pmcp:registry=${origin}\n`,
      );
      const catalog: RemoteCatalog = {
        revision: "r1",
        publishedAt: "2026-09-06T00:00:00.000Z",
        entries: [
          {
            productId: "example",
            title: "Example",
            summary: "Example skill",
            delivery: {
              packageName: "@pmcp/example",
              version: "1.0.0",
              integrity,
            },
            skillRevision: 1,
            contentDigest:
              "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            targets: [
              {
                packageName: "example",
                range: "^2.0.0",
                verifiedVersions: ["2.1.0"],
              },
            ],
          },
        ],
      };
      const marker = join(project, "INSTALL_HOOK_RAN");
      const context = installContext(project);
      const plan = planInstall({
        context,
        catalog,
        inventory: readInstalledDependencies(project),
        selected: [],
        all: true,
        sync: false,
      });
      const registry = temporaryRegistryConfig({
        id: "11111111-1111-4111-8111-111111111111",
        token: "pmcp_" + "a".repeat(43),
        registry: `${origin}/`,
        scope: "@pmcp",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      // The registry is HTTPS in production. Only this self-signed fixture
      // disables certificate verification, inside its temporary config.
      appendFileSync(registry.path, "strict-ssl=false\n");
      try {
        try {
          expect(
            applyInstallPlan(
              plan,
              createPackageManagerRunner(
                registry.path,
                {
                  ...baseEnv,
                  ...registry.environment,
                  npm_config_registry: origin,
                  PMCP_TEST_MARKER: marker,
                  NODE_TLS_REJECT_UNAUTHORIZED: "0",
                },
                new Map([["@pmcp/example@1.0.0", integrity]]),
              ),
            ),
          ).toBe(0);
        } catch (error) {
          const requests = existsSync(requestLog)
            ? readFileSync(requestLog, "utf8").trim().split("\n").slice(-4)
            : [];
          throw new Error(
            `${manager}: ${error instanceof Error ? error.message : "failed"}; requests=${requests.join(" | ")}`,
          );
        }
      } finally {
        registry.close();
      }
      expect(
        JSON.parse(readFileSync(join(project, "package.json"), "utf8"))
          .devDependencies["@pmcp/example"],
      ).toBe("1.0.0");
      expect(
        existsSync(
          join(project, "node_modules/@pmcp/example/skills/example/SKILL.md"),
        ),
      ).toBe(true);
      expect(existsSync(marker)).toBe(false);
      expect(
        existsSync(
          join(project, manager === "npm" ? "package-lock.json" : "bun.lock"),
        ),
      ).toBe(true);
    }
  } finally {
    if (server && server.exitCode === null) {
      server.kill();
      await once(server, "exit");
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 120000);
