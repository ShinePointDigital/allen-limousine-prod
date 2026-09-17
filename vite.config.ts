import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";

const buildId = new Date().toISOString().replace(/\D/g, "");

export default defineConfig({
  define: {
    __ALLAN_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    {
      name: "stamp-pwa-service-worker",
      apply: "build",
      async closeBundle() {
        const serviceWorkerPath = new URL("./dist/sw.js", import.meta.url);
        const source = await readFile(serviceWorkerPath, "utf8");
        if (!source.includes("__ALLAN_BUILD_ID__")) throw new Error("The service-worker build placeholder is missing.");
        await writeFile(serviceWorkerPath, source.replaceAll("__ALLAN_BUILD_ID__", buildId));
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443 },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
});