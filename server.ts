import express from "express";
import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createApiApp } from "./appServer.ts";
import { startSupabaseRealtimeBridge } from "./supabaseSync.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HOST = "0.0.0.0";

async function startServer() {
  const app = createApiApp();

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
      const indexFile = path.join(distDir, "index.html");
      if (fs.existsSync(indexFile)) {
        return res.sendFile(indexFile);
      }
      return res.status(404).send("Not found");
    });
  }

  app.listen(PORT, HOST, () => {
    startSupabaseRealtimeBridge();
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
