import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "node22",
  platform: "node",
  dts: true,
  clean: true,
  external: ["node:crypto"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
});
