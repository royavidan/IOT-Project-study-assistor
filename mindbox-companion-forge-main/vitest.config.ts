import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Standalone Vitest config — intentionally does NOT load the app's vite.config
// (which pulls in TanStack Start / nitro plugins) so unit tests stay fast and
// run in plain Node. Only pure logic is tested here.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
