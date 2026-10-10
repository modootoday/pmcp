import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { createArchive, integrity } from "../src/install/archive.js";
import { publicMarketplaceRoot } from "../src/marketplace/builtin.js";
import {
  catalogProvider,
  REMOTE_OPTIONS,
  remoteCatalog,
} from "../src/commands/remote-options.js";
import { parseArgs, type CommandContext } from "../src/cli/command.js";
import {
  preparePublicDelivery,
  publicArchiveFiles,
  publicArchiveUrl,
  publicInstallPlan,
  verifyPublicDelivery,
} from "../src/install/public.js";
import type { RemoteCatalog, RemoteEntry } from "../src/remote/catalog.js";
import {
  contentDigest,
  verifyInstalledContent,
} from "../src/install/verify-content.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-public-install-"));
  roots.push(root);
  return root;
}
function entry(): RemoteEntry {
  return JSON.parse(
    readFileSync(join(publicMarketplaceRoot(), "docs/catalog.json"), "utf8"),
  ).entries.find(
    (item: RemoteEntry) =>
      item.productId === "typescript" && item.line?.major === 5,
  );
}
function context(
  flags: string[] = [],
  env: NodeJS.ProcessEnv = {},
): CommandContext {
  return {
    cwd: temporary(),
    env,
    ui: {} as CommandContext["ui"],
    args: parseArgs(flags, REMOTE_OPTIONS),
  };
}
function archive(item = entry()): Buffer {
  return readFileSync(
    join(
      publicMarketplaceRoot(),
      "docs/skills",
      item.productId,
      String(item.line!.major),
      "package.tgz",
    ),
  );
}

it("loads the bundled public catalog without network or login", async () => {
  const network = vi.fn(() => {
    throw new Error("must not fetch");
  });
  vi.stubGlobal("fetch", network);
  expect((await remoteCatalog(context())).entries).toHaveLength(132);
  expect(network).not.toHaveBeenCalled();
  expect(catalogProvider(context())).toBe("public");
  expect(
    catalogProvider(
      context(["--provider", "public"], {
        PMCP_API_ORIGIN: "https://example.com",
      }),
    ),
  ).toBe("public");
  expect(catalogProvider(context(["--provider", "hosted"]))).toBe("hosted");
  expect(catalogProvider(context(["--api", "https://example.com"]))).toBe(
    "hosted",
  );
  expect(() =>
    catalogProvider(
      context(["--provider", "public", "--api", "https://example.com"]),
    ),
  ).toThrow("does not accept");
  expect(() => catalogProvider(context(["--provider", "unknown"]))).toThrow(
    "public or hosted",
  );
});
it("verifies the public archive before preparing exact immutable URL specs", async () => {
  const item = entry();
  const body = archive(item);
  const requests: string[] = [];
  const fetcher = vi.fn(
    async (url: string | URL | Request, options?: RequestInit) => {
      requests.push(String(url));
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toBeUndefined();
      return new Response(new Uint8Array(body));
    },
  ) as typeof fetch;
  const plan = {
    changes: [item.delivery],
    command: {
      executable: "npm",
      cwd: "/fixture",
      args: [
        "install",
        `${item.delivery.packageName}@${item.delivery.version}`,
      ],
    },
  };
  const catalog = { entries: [item] } as RemoteCatalog;
  const result = await preparePublicDelivery(plan, catalog, fetcher);
  expect(requests).toEqual([publicArchiveUrl(item)]);
  const identity = `${item.delivery.packageName}@${item.delivery.version}`;
  expect(result.integrity.get(identity)).toBe(item.delivery.integrity);
  expect(publicInstallPlan(plan, catalog).command.args[1]).toBe(
    `${item.delivery.packageName}@${publicArchiveUrl(item)}`,
  );
});
it("rejects archive corruption and unsafe product paths", () => {
  const item = entry();
  expect(() => publicArchiveFiles(item, Buffer.from("corrupt"))).toThrow(
    "integrity differs",
  );
  expect(() => publicArchiveUrl({ ...item, productId: "../escape" })).toThrow(
    "product identifier",
  );
});
it("rejects executable package metadata even when its archive has matching integrity", () => {
  const item = entry();
  const files = new Map<string, Buffer>([
    [
      "package/package.json",
      Buffer.from(
        JSON.stringify({
          name: item.delivery.packageName,
          version: item.delivery.version,
          scripts: { install: "echo unsafe" },
        }),
      ),
    ],
    ["package/LICENSE", Buffer.from("license")],
    ["package/skills/example/SKILL.md", Buffer.from("body")],
  ]);
  const body = createArchive(files);
  const altered = {
    ...item,
    delivery: { ...item.delivery, integrity: integrity(body) },
    contentDigest: contentDigest(
      new Map([["skills/example/SKILL.md", "body"]]),
    ),
  };
  expect(() => publicArchiveFiles(altered, body)).toThrow("content-only");
});
it("checks references and extra files after installation, including hoisted workspace packages", () => {
  const item = entry();
  const files = publicArchiveFiles(item, archive(item));
  const root = temporary();
  const project = join(root, "packages/example");
  mkdirSync(project, { recursive: true });
  for (const [path, bytes] of files) {
    const target = join(
      root,
      "node_modules",
      item.delivery.packageName,
      path.slice("package/".length),
    );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  const delivery = {
    integrity: new Map(),
    resources: new Map([[item.delivery.packageName, files]]),
  };
  expect(() => verifyPublicDelivery(project, delivery)).not.toThrow();
  expect(
    verifyInstalledContent(
      project,
      item.delivery.packageName,
      item.contentDigest,
    ).matched,
  ).toBe(true);
  writeFileSync(
    join(root, "node_modules", item.delivery.packageName, "unexpected.js"),
    "bad",
  );
  expect(() => verifyPublicDelivery(project, delivery)).toThrow(
    "unexpected resources",
  );
});
it("rejects missing or over-budget public downloads", async () => {
  const item = entry();
  const plan = { changes: [item.delivery] };
  const catalog = { entries: [item] } as RemoteCatalog;
  await expect(
    preparePublicDelivery(
      plan,
      catalog,
      vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch,
    ),
  ).rejects.toThrow("404");
  await expect(
    preparePublicDelivery(
      plan,
      catalog,
      vi.fn(
        async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)),
      ) as typeof fetch,
    ),
  ).rejects.toThrow("budget");
});
