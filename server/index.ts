import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app";
import { config } from "./config";
import { startSweeper } from "./sessions";
import { store } from "./store";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = config.production();
const port = Number(process.env.PORT || 8787);

if (production && !config.toolsToken()) {
  console.warn("[config] TOOLS_TOKEN is not set: the voice tutor's board tools are disabled until it is (see docs/DEPLOYMENT.md).");
}

// A bug in one request must never take the class down for everyone.
process.on("unhandledRejection", (err) => console.error("[process] unhandled rejection", (err as Error)?.message ?? err));
process.on("uncaughtException", (err) => console.error("[process] uncaught exception", err.message));

const { app, attachWebSocket } = createApp({ devTools: !production });
const server = createServer(app);
attachWebSocket(server);
startSweeper();

if (production) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  // A tour clip that hasn't been recorded is a 404, not the page (the tour then stays silent).
  app.use("/tour", (_req, res) => void res.status(404).end());
  app.use((req, res, next) => (req.method === "GET" ? res.sendFile(path.join(dist, "index.html")) : next()));
} else {
  const { createServer: createVite } = await import("vite");
  const vite = await createVite({
    configFile: path.join(root, "vite.config.ts"),
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const shutdown = () => {
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.listen(port, () => {
  console.log(`Shikshak running at http://localhost:${port}${production ? "" : "  (dev, add ?dev=1 for the tool simulator)"}`);
});
