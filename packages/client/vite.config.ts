import { defineConfig } from "vite";

const server = process.env.LFG_SERVER ?? "http://localhost:8080";

export default defineConfig({
  server: {
    port: 5173,
    proxy: { "/ws": { target: server.replace(/^http/, "ws"), ws: true } },
  },
  worker: { format: "es" },
  // LAB=1 builds the Creature Lab on its own with relative paths, to publish as a static page.
  ...(process.env.LAB ? { base: "./" } : {}),
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    ...(process.env.LAB ? { outDir: "dist-lab", emptyOutDir: true } : {}),
    rollupOptions: { input: process.env.LAB ? { lab: "lab.html" } : { main: "index.html", viewer: "viewer.html", lab: "lab.html" } },
  },
});
