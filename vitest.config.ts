import { defineConfig } from "vitest/config";

const source = (path: string): string =>
  new URL(path, import.meta.url).pathname;

export default defineConfig({
  resolve: {
    alias: {
      "@fungi.computer/sprite": source("./src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
