import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["ignored.mjs"] },
  { files: ["plain.mjs"], rules: { semi: ["error", "always"] } },
  {
    files: ["*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
);
