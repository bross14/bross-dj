import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// CSP solo en el build: en dev, Vite y React Refresh necesitan scripts inline.
// blob:/data: cubren el worker de análisis inline y los assets chicos inlineados.
const CSP = [
  "default-src 'self'",
  // deck de YouTube: script oficial de la IFrame API y su reproductor
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "worker-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com",
  // bross-media: video de las carpetas de la biblioteca (protocolo propio)
  "media-src 'self' blob: data: mediastream: bross-media:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function csp(): Plugin {
  return {
    name: "bross-csp",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig({
  plugins: [react(), csp()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
});
