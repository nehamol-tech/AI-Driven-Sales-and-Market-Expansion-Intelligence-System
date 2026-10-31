import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node environment only: components are tested via react-dom/server's
// static rendering, so no DOM emulation (jsdom) dependency is needed.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
