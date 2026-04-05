import { defineConfig } from "vitest/config";
import isDebugMode from "./_is-debug-mode";
import proposalDecorators from "./_proposal-decorators";

export default defineConfig({
  plugins: [
    proposalDecorators(),
  ],
  oxc: {
    target: "es2020",
  },
  define: {
    __DEBUG__: `${isDebugMode}`,
  },
  test: {
    include: [
      "tests/**/*.test.ts",
    ],
    exclude: [
      "tests/**/*.client.test.ts",
    ],
    setupFiles: [
      ".config/_debugging.ts",
    ],
  },
});
