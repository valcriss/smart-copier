import fs from "fs";
import path from "path";
import { fingerprintFile } from "../util/fingerprint.js";

export class WatcherService {
  constructor({ copyService, runtimeState, broadcaster, fileRepository }) {
    this.copyService = copyService;
    this.runtimeState = runtimeState;
    this.broadcaster = broadcaster;
    this.fileRepository = fileRepository;
    this.scanIntervals = new Map();
    this.fileStates = new Map();
  }

  start(associations, config) {
    this.stop();
    this.runtimeState.setAssociations(associations);
    this.runtimeState.setRunning(true);
    this.runtimeState.setTaskStatus("running");
    this.broadcaster.broadcast("state", this.runtimeState.snapshot());

    for (const assoc of associations) {
      this.fileStates.set(assoc.id, new Map());
      void this.scanAssociation(assoc, config).catch((error) => {
        this.runtimeState.setTaskStatus("error");
        this.runtimeState.addLog({
          time: new Date().toISOString(),
          level: "error",
          message: error.message ?? "Scan error"
        });
        this.broadcaster.broadcast("state", this.runtimeState.snapshot());
      });

      const interval = setInterval(() => {
        this.scanAssociation(assoc, config).catch((error) => {
          this.runtimeState.setTaskStatus("error");
          this.runtimeState.addLog({
            time: new Date().toISOString(),
            level: "error",
            message: error.message ?? "Scan error"
          });
          this.broadcaster.broadcast("state", this.runtimeState.snapshot());
        });
      }, config.scanIntervalSeconds * 1000);
      this.scanIntervals.set(assoc.id, interval);
    }
  }

  stop() {
    for (const interval of this.scanIntervals.values()) {
      clearInterval(interval);
    }
    this.scanIntervals.clear();
    this.fileStates.clear();
    this.runtimeState.setRunning(false);
    this.runtimeState.setTaskStatus("error");
  }

  async scanAssociation(association, config) {
    const state = this.fileStates.get(association.id) ?? new Map();
    const now = Date.now();
    const seen = new Set();
    const files = await walkFiles(association.input);

    for (const filePath of files) {
      seen.add(filePath);
      const ext = path.extname(filePath).toLowerCase();
      if (config.ignoredExtensions.includes(ext)) {
        this.#setState(state, filePath, {
          size: 0,
          lastCheckedAt: now,
          status: "ignored"
        });
        continue;
      }

      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          continue;
        }
        throw error;
      }

      const existing = state.get(filePath);
      if (!existing) {
        let fingerprintResult;
        try {
          fingerprintResult = await fingerprintFile(filePath);
        } catch (error) {
          if (error?.code === "ENOENT") {
            continue;
          }
          throw error;
        }

        const fingerprint = fingerprintResult.fingerprint;
        const alreadyCopied = await this.fileRepository.findByFingerprint(
          fingerprint,
          association.input
        );

        if (alreadyCopied?.status === "COPIED") {
          state.set(filePath, {
            size: stat.size,
            lastCheckedAt: now,
            status: "ignored",
            fingerprint
          });
        } else {
          state.set(filePath, {
            size: stat.size,
            lastCheckedAt: now,
            status: "pending",
            fingerprint
          });
        }
        continue;
      }

      existing.lastCheckedAt = now;

      if (existing.status === "ignored") {
        if (stat.size !== existing.size) {
          existing.size = stat.size;
          existing.status = "pending";
          delete existing.fingerprint;
          delete existing.inFlight;
        }
        continue;
      }

      if (existing.status === "to_copy") {
        if (!existing.inFlight && stat.size !== existing.size) {
          existing.size = stat.size;
          existing.status = "pending";
          delete existing.fingerprint;
        }
        continue;
      }

      if (existing.status === "pending") {
        if (stat.size === existing.size) {
          existing.status = "to_copy";
          existing.size = stat.size;
        } else {
          existing.size = stat.size;
          delete existing.fingerprint;
        }
      }
    }

    for (const filePath of state.keys()) {
      if (!seen.has(filePath)) {
        state.delete(filePath);
      }
    }

    this.fileStates.set(association.id, state);
    this.#updateCounts(association.id, state);
    this.#enqueueCopies(state, association, config);
  }

  async rescanAll(config) {
    for (const association of this.runtimeState.associations) {
      await this.scanAssociation(association, config);
    }
  }

  #updateCounts(associationId, state) {
    let pending = 0;
    let toCopy = 0;
    for (const record of state.values()) {
      if (record.status === "pending") {
        pending += 1;
      } else if (record.status === "to_copy") {
        toCopy += 1;
      }
    }
    this.runtimeState.setAssociationPendingCount(associationId, pending);
    this.runtimeState.setAssociationToCopyCount(associationId, toCopy);
    this.broadcaster.broadcast("state", this.runtimeState.snapshot());
  }

  #enqueueCopies(state, association, config) {
    for (const [filePath, record] of state.entries()) {
      if (record.status !== "to_copy" || record.inFlight) {
        continue;
      }
      record.inFlight = true;
      const fingerprint = record.fingerprint;
      const size = record.size;
      this.copyService
        .enqueueCopy(filePath, association, config, fingerprint, size)
        .then((result) => {
          record.inFlight = false;
          if (result === "copied" || result === "skipped") {
            record.status = "ignored";
          }
          this.#updateCounts(association.id, state);
        })
        .catch((error) => {
          record.inFlight = false;
          this.runtimeState.setTaskStatus("error");
          this.runtimeState.addLog({
            time: new Date().toISOString(),
            level: "error",
            message: error?.message ?? "Copy error"
          });
          this.broadcaster.broadcast("state", this.runtimeState.snapshot());
        });
    }
  }

  #setState(state, filePath, next) {
    const existing = state.get(filePath);
    if (!existing) {
      state.set(filePath, next);
      return;
    }
    existing.size = next.size;
    existing.lastCheckedAt = next.lastCheckedAt;
    existing.status = next.status;
    delete existing.fingerprint;
    delete existing.inFlight;
  }
}

async function walkFiles(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkFiles(fullPath);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}
