import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { packageVersions } from "./packages.mjs";
import { apiContractConfiguration } from "./dev-config.mjs";
import { cleanupSteps, step } from "./lifecycle.mjs";

function createPlugins(react, tailwindPlugin) {
  const plugins = [react()];
  if (tailwindPlugin) plugins.push(tailwindPlugin());
  return plugins;
}

export async function verifyBuild({
  scratchRoot,
  sourceRoot,
  major,
  tailwind = false,
}) {
  const dependencyRoot = resolve(scratchRoot);
  const require = createRequire(join(dependencyRoot, "package.json"));
  const { build, createServer } = await import(
    pathToFileURL(require.resolve("vite")).href
  );
  const { default: react } = await import(
    pathToFileURL(require.resolve("@vitejs/plugin-react")).href
  );
  const viteRequire = createRequire(require.resolve("vite"));
  const esbuild = await import(
    pathToFileURL(viteRequire.resolve("esbuild")).href
  );
  const names = ["vite", "@vitejs/plugin-react", "react", "react-dom"];
  if (tailwind) names.push("tailwindcss", "@tailwindcss/vite");
  const packages = await packageVersions(require, names);
  packages.esbuild = esbuild.version;
  assert.equal(Number(packages.vite.split(".")[0]), major);
  const directory = await mkdtemp(join(dependencyRoot, `pmcp-vite${major}-`));
  const originalNodeEnv = process.env.NODE_ENV;
  let server;
  let shutdownStarted = false;
  let primaryError;
  try {
    await cp(sourceRoot, directory, { recursive: true });
    await cp(join(directory, "env.fixture.txt"), join(directory, ".env"));
    await symlink(
      join(dependencyRoot, "node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    let tailwindPlugin;
    if (tailwind) {
      const module = await import(
        pathToFileURL(require.resolve("@tailwindcss/vite")).href
      );
      tailwindPlugin = module.default;
    }
    const config = {
      root: directory,
      configFile: false,
      base: "/fixture/",
      logLevel: "error",
      build: { minify: false, cssMinify: false },
    };
    process.env.NODE_ENV = "production";
    await step(
      "production build",
      () => build({ ...config, plugins: createPlugins(react, tailwindPlugin) }),
      120000,
    );
    const html = await readFile(join(directory, "dist", "index.html"), "utf8");
    assert.match(html, /\/fixture\/assets\//);
    const assetRoot = join(directory, "dist", "assets");
    const files = await readdir(assetRoot);
    const javascript = (
      await Promise.all(
        files
          .filter((file) => file.endsWith(".js"))
          .map((file) => readFile(join(assetRoot, file), "utf8")),
      )
    ).join("\n");
    assert.match(javascript, /PublicLabel/);
    assert.ok(!javascript.includes("NotForClient"));
    const checks = [
      "TSX production build",
      "base-aware asset paths",
      "public environment replacement and private variable exclusion",
    ];
    if (tailwind) {
      const css = (
        await Promise.all(
          files
            .filter((file) => file.endsWith(".css"))
            .map((file) => readFile(join(assetRoot, file), "utf8")),
        )
      ).join("\n");
      assert.match(css, /\.grid\s*\{/);
      assert.match(css, /\.p-4\s*\{/);
      assert.match(css, /\.bg-accent\s*\{/);
      assert.match(css, /--color-accent/);
      checks.push(
        "Tailwind 4 Vite plugin source detection and theme utilities",
      );
    }
    process.env.NODE_ENV = "development";
    server = await step("dev server creation", () =>
      createServer({
        ...config,
        plugins: [
          ...createPlugins(react, tailwindPlugin),
          apiContractConfiguration(),
        ],
        server: {
          host: "127.0.0.1",
          port: 0,
          strictPort: true,
          open: false,
          watch: null,
        },
      }),
    );
    assert.equal(server.config.server.watch, null);
    assert.equal(server.config.optimizeDeps.noDiscovery, true);
    assert.deepEqual(server.config.optimizeDeps.include, []);
    await step("dev server listen", () => server.listen());
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== "string");
    const response = await step("dev HTML request", () =>
      fetch(`http://127.0.0.1:${address.port}/fixture/`, {
        signal: AbortSignal.timeout(5000),
      }),
    );
    assert.equal(response.status, 200);
    assert.match(await response.text(), /@react-refresh/);
    const transformed = await step("dev TSX transform", () =>
      server.transformRequest("/src/main.tsx"),
    );
    assert.ok(transformed);
    assert.ok(!transformed.code.includes("initial: number"));
    checks.push("dev HTML Fast Refresh preamble and TSX transform");
    shutdownStarted = true;
    await step("dev server shutdown", () => server.close());
    assert.equal(server.httpServer.listening, false);
    server = undefined;
    checks.push("dev server shutdown");
    return {
      productId: "vite",
      companionProductIds: tailwind
        ? ["vitejs-plugin-react", "tailwindcss"]
        : ["vitejs-plugin-react"],
      verifiedOn: new Date().toISOString(),
      verifiedVersions: [packages.vite],
      packages,
      examplesExecuted: checks.length,
      checks,
      environment: `Node ${process.versions.node}; loopback API dev server with dependency optimizer and file watching disabled; production build`,
      cleanedUp: true,
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      const cleanup = [];
      if (server && !shutdownStarted) {
        cleanup.push({
          name: "dev server cleanup",
          operation: () => server.close(),
        });
      }
      cleanup.push({
        name: "esbuild service shutdown",
        operation: () => esbuild.stop(),
      });
      cleanup.push({
        name: "temporary directory cleanup",
        operation: () => rm(directory, { recursive: true, force: true }),
      });
      await cleanupSteps(cleanup, primaryError);
      process.stderr.write(
        `Vite fixture remaining resource types: ${JSON.stringify(process.getActiveResourcesInfo())}\n`,
      );
    } finally {
      if (originalNodeEnv === undefined) {
        Reflect.deleteProperty(process.env, "NODE_ENV");
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  }
}
