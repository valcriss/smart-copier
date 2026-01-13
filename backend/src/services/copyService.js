import fs from "fs";
import path from "path";
import { fingerprintFile } from "../util/fingerprint.js";

export class CopyService {
  constructor({ fileRepository, envConfig, runtimeState, broadcaster }) {
    this.fileRepository = fileRepository;
    this.envConfig = envConfig;
    this.runtimeState = runtimeState;
    this.broadcaster = broadcaster;
    this.queue = [];
    this.processing = false;
    this.verifyingByAssociation = new Map();
    this.queuedByAssociation = new Map();
    this.stability = new Map();
  }

  async enqueue(filePath, association, config) {
    try {
      return await this.#observeFile(filePath, association, config);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      this.runtimeState.setAssociationStatus(association.id, "error", null);
      this.runtimeState.addLog({
        time: new Date().toISOString(),
        level: "error",
        message
      });
      this.broadcaster.broadcast("state", this.runtimeState.snapshot());
    }
  }

  async #processQueue() {
    if (this.processing) {
      return;
    }
    const next = this.queue.shift();
    if (!next) {
      return;
    }
    this.processing = true;
    this.#clearQueued(next.association.id, next.filePath);
    try {
      await this.#handleFile(next);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.#processQueue();
      }
    }
  }

  async #handleFile({ filePath, association, config, fingerprint, size }) {
    let resolvedFingerprint = fingerprint ?? null;
    let resolvedSize = size;
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (config.ignoredExtensions.includes(ext)) {
        return;
      }

      if (!resolvedFingerprint || resolvedSize === undefined) {
        const fingerprintResult = await fingerprintFile(filePath);
        resolvedFingerprint = fingerprintResult.fingerprint;
        resolvedSize = fingerprintResult.size;
      }
      const sourceRoot = association.input;
      const existing = await this.fileRepository.findByFingerprint(resolvedFingerprint, sourceRoot);
      if (existing?.status === "COPIED") {
        return;
      }

      const relative = path.relative(association.input, filePath);
      const destinationPath = path.join(association.output, relative);
      const filename = path.basename(filePath);
      const firstSeenAt = new Date().toISOString();

      if (!existing) {
        await this.fileRepository.insertPending({
          fingerprint: resolvedFingerprint,
          filename,
          sourcePath: filePath,
          sourceRoot,
          destinationPath,
          size: resolvedSize,
          status: "PENDING",
          firstSeenAt
        });
      }

      await this.fileRepository.markCopying(resolvedFingerprint, sourceRoot);
      this.runtimeState.setAssociationStatus(association.id, "copying", {
        filename,
        sourcePath: filePath,
        destinationPath,
        size: resolvedSize,
        copiedBytes: 0,
        percent: 0,
        speedBytesPerSecond: 0,
        etaSeconds: null
      });
      this.broadcaster.broadcast("state", this.runtimeState.snapshot());

      if (config.dryRun) {
        await this.fileRepository.markCopied(
          resolvedFingerprint,
          sourceRoot,
          destinationPath,
          new Date().toISOString()
        );
        this.runtimeState.setAssociationStatus(association.id, "idle", null);
        this.broadcaster.broadcast("state", this.runtimeState.snapshot());
        return;
      }

      await this.#copyFile(
        filePath,
        destinationPath,
        association.output,
        relative,
        association.id,
        resolvedSize
      );
      await this.fileRepository.markCopied(
        resolvedFingerprint,
        sourceRoot,
        destinationPath,
        new Date().toISOString()
      );
      this.runtimeState.setAssociationStatus(association.id, "idle", null);
      this.broadcaster.broadcast("state", this.runtimeState.snapshot());
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      if (resolvedFingerprint) {
        await this.fileRepository.markFailed(resolvedFingerprint, association.input, message);
      }
      this.runtimeState.setAssociationStatus(association.id, "error", null);
      this.runtimeState.addLog({
        time: new Date().toISOString(),
        level: "error",
        message
      });
      this.broadcaster.broadcast("state", this.runtimeState.snapshot());
    }
  }

  async #observeFile(filePath, association, config) {
    const ext = path.extname(filePath).toLowerCase();
    if (config.ignoredExtensions.includes(ext)) {
      this.#clearVerifying(association.id, filePath);
      this.#clearQueued(association.id, filePath);
      this.#clearStability(filePath);
      return;
    }

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      this.#clearVerifying(association.id, filePath);
      this.#clearQueued(association.id, filePath);
      this.#clearStability(filePath);
      return;
    }

    const windowMs = this.envConfig.getStabilityWindowSeconds() * 1000;
    if (windowMs === 0) {
      this.#clearVerifying(association.id, filePath);
      this.#clearStability(filePath);
      await this.#enqueueCandidate(filePath, association, config);
      return;
    }
    const now = Date.now();
    const existing = this.stability.get(filePath);
    const changed =
      !existing || existing.lastSize !== stat.size || existing.lastMtime !== stat.mtimeMs;

    if (changed) {
      if (existing?.timer) {
        clearTimeout(existing.timer);
      }
      const stableAt = now + windowMs;
      const timer = this.#scheduleStabilityCheck(filePath, association, config, windowMs);
      this.stability.set(filePath, {
        lastSize: stat.size,
        lastMtime: stat.mtimeMs,
        stableAt,
        timer
      });
      this.#markVerifying(association.id, filePath);
      return;
    }

    if (now < existing.stableAt) {
      if (!existing.timer) {
        const remaining = Math.max(existing.stableAt - now, 0);
        existing.timer = this.#scheduleStabilityCheck(
          filePath,
          association,
          config,
          remaining
        );
      }
      this.#markVerifying(association.id, filePath);
      return;
    }

    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    this.stability.delete(filePath);
    this.#clearVerifying(association.id, filePath);
    await this.#enqueueCandidate(filePath, association, config);
  }

  #scheduleStabilityCheck(filePath, association, config, delayMs) {
    return setTimeout(() => {
      const entry = this.stability.get(filePath);
      if (entry) {
        entry.timer = null;
      }
      this.enqueue(filePath, association, config);
    }, delayMs);
  }

  async #enqueueCandidate(filePath, association, config) {
    const { fingerprint, size } = await this.#prepareCandidate(filePath, association);
    if (!fingerprint) {
      return;
    }
    if (this.#markQueued(association.id, filePath)) {
      this.queue.push({ filePath, association, config, fingerprint, size });
      await this.#processQueue();
    }
  }

  async #prepareCandidate(filePath, association) {
    const fingerprintResult = await fingerprintFile(filePath);
    const fingerprint = fingerprintResult.fingerprint;
    const size = fingerprintResult.size;
    const existing = await this.fileRepository.findByFingerprint(
      fingerprint,
      association.input
    );
    if (existing?.status === "COPIED") {
      return { fingerprint: null, size: null };
    }
    return { fingerprint, size };
  }

  #markVerifying(associationId, filePath) {
    let verifying = this.verifyingByAssociation.get(associationId);
    if (!verifying) {
      verifying = new Set();
      this.verifyingByAssociation.set(associationId, verifying);
    }
    const before = verifying.size;
    verifying.add(filePath);
    if (verifying.size !== before) {
      this.runtimeState.setAssociationVerifyingCount(associationId, verifying.size);
      this.broadcaster.broadcast("state", this.runtimeState.snapshot());
    }
  }

  #clearVerifying(associationId, filePath) {
    const verifying = this.verifyingByAssociation.get(associationId);
    if (!verifying) {
      return;
    }
    const before = verifying.size;
    verifying.delete(filePath);
    if (verifying.size === 0) {
      this.verifyingByAssociation.delete(associationId);
    }
    if (verifying.size !== before) {
      this.runtimeState.setAssociationVerifyingCount(associationId, verifying.size);
      this.broadcaster.broadcast("state", this.runtimeState.snapshot());
    }
  }

  #markQueued(associationId, filePath) {
    let queued = this.queuedByAssociation.get(associationId);
    if (!queued) {
      queued = new Set();
      this.queuedByAssociation.set(associationId, queued);
    }
    const before = queued.size;
    queued.add(filePath);
    if (queued.size !== before) {
      this.runtimeState.setAssociationQueuedCount(associationId, queued.size);
      this.broadcaster.broadcast("state", this.runtimeState.snapshot());
    }
    return queued.size !== before;
  }

  #clearQueued(associationId, filePath) {
    const queued = this.queuedByAssociation.get(associationId);
    if (!queued) {
      return;
    }
    const before = queued.size;
    queued.delete(filePath);
    if (queued.size === 0) {
      this.queuedByAssociation.delete(associationId);
    }
    if (queued.size !== before) {
      this.runtimeState.setAssociationQueuedCount(associationId, queued.size);
      this.broadcaster.broadcast("state", this.runtimeState.snapshot());
    }
  }

  #clearStability(filePath) {
    const existing = this.stability.get(filePath);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    this.stability.delete(filePath);
  }

  async #copyFile(
    sourcePath,
    destinationPath,
    destinationRoot,
    relativePath,
    associationId,
    totalBytes
  ) {
    const tempPath = path.join(
      destinationRoot,
      ".tmp",
      `${relativePath}.partial`
    );
    await fs.promises.mkdir(path.dirname(tempPath), { recursive: true });
    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });

    const startTime = Date.now();
    let copiedBytes = 0;

    await new Promise((resolve, reject) => {
      const reader = fs.createReadStream(sourcePath);
      const writer = fs.createWriteStream(tempPath);
      reader.on("data", (chunk) => {
        copiedBytes += chunk.length;
        const elapsedSeconds = Math.max((Date.now() - startTime) / 1000, 0.001);
        const speed = copiedBytes / elapsedSeconds;
        const remaining = Math.max(totalBytes - copiedBytes, 0);
        const eta = speed > 0 ? Math.ceil(remaining / speed) : null;
        const percent = totalBytes > 0 ? Math.round((copiedBytes / totalBytes) * 100) : 100;
        this.runtimeState.setAssociationStatus(associationId, "copying", {
          filename: path.basename(sourcePath),
          sourcePath,
          destinationPath,
          size: totalBytes,
          copiedBytes,
          percent,
          speedBytesPerSecond: Math.round(speed),
          etaSeconds: eta
        });
        this.broadcaster.broadcast("state", this.runtimeState.snapshot());
      });
      reader.on("error", reject);
      writer.on("error", reject);
      writer.on("close", resolve);
      reader.pipe(writer);
    });

    await fs.promises.rename(tempPath, destinationPath);
    await cleanupTempDirectory(path.dirname(tempPath), path.join(destinationRoot, ".tmp"));
  }
}

async function cleanupTempDirectory(startDir, tempRoot) {
  let current = startDir;
  while (current.startsWith(tempRoot)) {
    try {
      const entries = await fs.promises.readdir(current);
      if (entries.length > 0) {
        break;
      }
      await fs.promises.rmdir(current);
    } catch {
      break;
    }
    if (current === tempRoot) {
      break;
    }
    current = path.dirname(current);
  }
}
