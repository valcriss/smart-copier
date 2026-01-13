import fs from "fs";
import path from "path";
import { fingerprintFile } from "../util/fingerprint.js";
import { isFileStable } from "../util/fileStability.js";

export class CopyService {
  constructor({ fileRepository, envConfig, runtimeState, broadcaster }) {
    this.fileRepository = fileRepository;
    this.envConfig = envConfig;
    this.runtimeState = runtimeState;
    this.broadcaster = broadcaster;
    this.queue = [];
    this.processing = false;
  }

  enqueue(filePath, association, config) {
    this.queue.push({ filePath, association, config });
    this.#processQueue();
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
    try {
      await this.#handleFile(next.filePath, next.association, next.config);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.#processQueue();
      }
    }
  }

  async #handleFile(filePath, association, config) {
    let fingerprint = null;
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (config.ignoredExtensions.includes(ext)) {
        return;
      }

      const stable = await isFileStable(
        filePath,
        this.envConfig.getStabilityWindowSeconds()
      );
      if (!stable) {
        return;
      }

      const fingerprintResult = await fingerprintFile(filePath);
      fingerprint = fingerprintResult.fingerprint;
      const size = fingerprintResult.size;
      const existing = await this.fileRepository.findByFingerprint(fingerprint);
      if (existing?.status === "COPIED") {
        return;
      }

      const relative = path.relative(association.input, filePath);
      const destinationPath = path.join(association.output, relative);
      const filename = path.basename(filePath);
      const firstSeenAt = new Date().toISOString();

      if (!existing) {
        await this.fileRepository.insertPending({
          fingerprint,
          filename,
          sourcePath: filePath,
          destinationPath,
          size,
          status: "PENDING",
          firstSeenAt
        });
      }

      await this.fileRepository.markCopying(fingerprint);
      this.runtimeState.setAssociationStatus(association.id, "copying", {
        filename,
        sourcePath: filePath,
        destinationPath,
        size,
        copiedBytes: 0,
        percent: 0,
        speedBytesPerSecond: 0,
        etaSeconds: null
      });
      this.broadcaster.broadcast("state", this.runtimeState.snapshot());

      if (config.dryRun) {
        await this.fileRepository.markCopied(
          fingerprint,
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
        size
      );
      await this.fileRepository.markCopied(
        fingerprint,
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
      if (fingerprint) {
        await this.fileRepository.markFailed(fingerprint, message);
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
