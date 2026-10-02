import { defineConfig } from "vite";

const server = process.env.LFG_SERVER ?? "http://localhost:8080";

export default defineConfig({
  server: {
    port: 5173,
    proxy: { "/ws": { target: server.replace(/^http/, "ws"), ws: true } },
  },
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: "index.html", viewer: "viewer.html" } },
  },
});
