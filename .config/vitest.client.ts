import { playwright } from "@vitest/browser-playwright";
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
      "tests/**/*.server.test.ts",
    ],
    browser: {
      provider: playwright({
        contextOptions: {
          permissions: [
            "storage-access",
          ],
        },
      }),
      enabled: true,
      headless: true,
      instances: [
        { browser: "chromium" },
      ],
    },
    setupFiles: [
      ".config/_debugging.ts",
    ],
  },
});
