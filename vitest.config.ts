import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // src は jsdom、scripts（DOM を使わない Node 向けスクリプトのテスト）は node で動かす。
    // jsdom の起動は1ファイルあたり数秒かかり、夜間ジョブの負荷下ではタイムアウトの要因になる。
    projects: [
      {
        extends: true,
        test: {
          name: "src",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "scripts",
          environment: "node",
          include: ["scripts/**/*.test.ts", "worker/**/*.test.ts"],
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
