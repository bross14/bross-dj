import { defineConfig } from "vitest/config";

// Tests de interfaz de punta a punta (abren la app en Electron): npm run test:ui
export default defineConfig({
  test: {
    include: ["tests/ui/**/*.e2e.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 160000,
    fileParallelism: false,
  },
});
