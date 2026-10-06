import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  // 優待のバックテスト（scripts/backtest/）は使い捨ての検証スクリプトで、JSON をそのまま any で扱う。
  {
    files: ["scripts/backtest/**/*.mts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Project-local scratch/temp files are never lint targets.
    "scratch/**",
    // Cloudflare (OpenNext / wrangler) の生成物。
    ".open-next/**",
    ".wrangler/**",
    "cloudflare-env.d.ts",
  ]),
]);

export default eslintConfig;
