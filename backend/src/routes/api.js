import express from "express";
import fs from "fs";
import path from "path";

export function buildApiRouter({
  associationService,
  watcherService,
  runtimeState,
  fileRepository,
  envConfig,
  broadcaster
}) {
  const router = express.Router();

  router.get("/config", async (req, res) => {
    const config = await associationService.getEffectiveConfig();
    const allowedRoots = await resolveAllowedRoots(envConfig);
    res.json({
      config,
      allowedRoots
    });
  });

  router.put("/config", async (req, res) => {
    try {
      const stored = await associationService.updateConfig(req.body ?? {});
      const effective = envConfig.resolveConfig(stored);
      runtimeState.setAssociations(effective.associations);
      watcherService.start(effective.associations, effective);
      broadcaster.broadcast("state", runtimeState.snapshot());
      res.json({ config: effective });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get("/status", (req, res) => {
    res.json(runtimeState.snapshot());
  });

  router.get("/history", async (req, res) => {
    const history = await fileRepository.listHistory();
    res.json({ items: history });
  });

  router.get("/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write("event: state\n");
    res.write(`data: ${JSON.stringify(runtimeState.snapshot())}\n\n`);
    broadcaster.addClient(res);
  });

  return router;
}

async function resolveAllowedRoots(envConfig) {
  const sourceRoots = envConfig.getAllowedSourceRoots();
  const destinationRoots = envConfig.getAllowedDestinationRoots();
  return {
    source: await listSubdirectories(sourceRoots),
    destination: await listSubdirectories(destinationRoots)
  };
}

async function listSubdirectories(roots, depth = 2) {
  const results = [];
  for (const root of roots) {
    try {
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        results.push(toPosixPath(root, entry.name));
        if (depth > 1) {
          await appendSecondLevel(results, root, entry.name);
        }
      }
    } catch {
      // Ignore missing roots to keep UI responsive.
    }
  }
  return results;
}

async function appendSecondLevel(results, root, entryName) {
  try {
    const nestedPath = path.join(root, entryName);
    const nestedEntries = await fs.promises.readdir(nestedPath, { withFileTypes: true });
    for (const nestedEntry of nestedEntries) {
      if (nestedEntry.isDirectory()) {
        results.push(toPosixPath(root, entryName, nestedEntry.name));
      }
    }
  } catch {
    // Ignore missing nested roots to keep UI responsive.
  }
}

function toPosixPath(root, ...parts) {
  const normalizedRoot = root.replace(/\\/g, "/");
  return path.posix.join(normalizedRoot, ...parts);
}
