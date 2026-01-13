import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { buildApiRouter } from "./routes/api.js";

export function createApp(deps) {
  const app = express();
  app.use(express.json());

  app.use("/api", buildApiRouter(deps));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));

  app.get("*", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}