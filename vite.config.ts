import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { renderStaticLegalPage, staticLegalDocuments, staticLegalPath } from "./src/legal/static-legal-pages";

const buildId = new Date().toISOString().replace(/\D/g, "");

export default defineConfig({
  define: {
    __ALLAN_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    {
      name: "public-static-legal-documents",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const pathname = staticLegalPath((request.url || "/").split("?")[0]);
          if (!pathname || !["GET", "HEAD"].includes(request.method || "")) return next();
          try {
            const css = await readFile(new URL("./src/legal/legal-page.css", import.meta.url), "utf8");
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            response.end(request.method === "HEAD" ? undefined : renderStaticLegalPage(pathname, css));
          } catch (error) {
            next(error);
          }
        });
      },
      async writeBundle() {
        const css = await readFile(new URL("./src/legal/legal-page.css", import.meta.url), "utf8");
        for (const pathname of Object.keys(staticLegalDocuments)) {
          const legalPath = staticLegalPath(pathname)!;
          await writeFile(new URL(`./dist${legalPath}.html`, import.meta.url), renderStaticLegalPage(legalPath, css));
        }
      },
    },
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