import chokidar from "chokidar";
import fs from "fs";
import path from "path";

export class WatcherService {
  constructor({ copyService, runtimeState, broadcaster }) {
    this.copyService = copyService;
    this.runtimeState = runtimeState;
    this.broadcaster = broadcaster;
    this.watchers = new Map();
    this.scanIntervals = new Map();
  }

  start(associations, config) {
    this.stop();
    this.runtimeState.setAssociations(associations);
    this.runtimeState.setRunning(true);
    this.runtimeState.setTaskStatus("running");
    this.broadcaster.broadcast("state", this.runtimeState.snapshot());

    for (const assoc of associations) {
      const watcher = chokidar.watch(assoc.input, {
        ignoreInitial: false,
        awaitWriteFinish: false,
        depth: 99,
        persistent: true
      });

      watcher.on("add", (filePath) => {
        this.copyService.enqueue(filePath, assoc, config);
      });
      watcher.on("change", (filePath) => {
        this.copyService.enqueue(filePath, assoc, config);
      });
      watcher.on("addDir", (dirPath) => {
        this.#ensureDestinationDirectory(assoc, dirPath);
        this.rescanAssociation(assoc, config);
      });
      watcher.on("error", (error) => {
        this.runtimeState.setTaskStatus("error");
        this.runtimeState.addLog({
          time: new Date().toISOString(),
          level: "error",
          message: error.message ?? "Watcher error"
        });
        this.broadcaster.broadcast("state", this.runtimeState.snapshot());
      });

      this.watchers.set(assoc.id, watcher);

      void this.rescanAssociation(assoc, config).catch((error) => {
        this.runtimeState.setTaskStatus("error");
        this.runtimeState.addLog({
          time: new Date().toISOString(),
          level: "error",
          message: error.message ?? "Rescan error"
        });
        this.broadcaster.broadcast("state", this.runtimeState.snapshot());
      });

      const interval = setInterval(() => {
        this.rescanAssociation(assoc, config);
      }, config.scanIntervalSeconds * 1000);
      this.scanIntervals.set(assoc.id, interval);
    }
  }

  stop() {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    for (const interval of this.scanIntervals.values()) {
      clearInterval(interval);
    }
    this.watchers.clear();
    this.scanIntervals.clear();
    this.runtimeState.setRunning(false);
    this.runtimeState.setTaskStatus("error");
  }

  async rescanAssociation(association, config) {
    const { files, dirs } = await walkEntries(association.input);
    for (const dirPath of dirs) {
      await this.#ensureDestinationDirectory(association, dirPath);
    }
    for (const filePath of files) {
      this.copyService.enqueue(filePath, association, config);
    }
  }

  async rescanAll(config) {
    const associations = this.runtimeState.associations.map((assoc) => ({
      id: assoc.id,
      input: assoc.input,
      output: assoc.output
    }));
    for (const association of associations) {
      await this.rescanAssociation(association, config);
    }
  }

  async #ensureDestinationDirectory(association, dirPath) {
    const relative = path.relative(association.input, dirPath);
    if (!relative || relative === "." || relative.startsWith("..")) {
      return;
    }
    const destinationDir = path.join(association.output, relative);
    await fs.promises.mkdir(destinationDir, { recursive: true });
  }
}

async function walkEntries(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const results = { files: [], dirs: [] };
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.dirs.push(fullPath);
      const nested = await walkEntries(fullPath);
      results.files.push(...nested.files);
      results.dirs.push(...nested.dirs);
    } else if (entry.isFile()) {
      results.files.push(fullPath);
    }
  }
  return results;
}
