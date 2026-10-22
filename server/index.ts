import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 8787);

const { app, attachWebSocket } = createApp();
const server = createServer(app);
attachWebSocket(server);

if (production) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.use((_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  const { createServer: createVite } = await import("vite");
  const vite = await createVite({
    configFile: path.join(root, "vite.config.ts"),
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

server.listen(port, () => {
  console.log(`Kalam running at http://localhost:${port}${production ? "" : "  (dev, add ?dev=1 for the tool simulator)"}`);
});
