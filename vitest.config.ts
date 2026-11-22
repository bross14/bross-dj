import { defineConfig } from "vitest/config";

// Tests de la lógica pura (sin navegador): etiquetas, biblioteca, automix,
// análisis, MIDI, el reproductor del hilo de audio y los módulos de Electron.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
