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
  }

  enqueueCopy(filePath, association, config, fingerprint, size) {
    return new Promise((resolve) => {
      this.queue.push({ filePath, association, config, fingerprint, size, resolve });
      this.#processQueue();
    });
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
      const result = await this.#handleCopy(next);
      next.resolve(result);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        this.#processQueue();
      }
    }
  }

  async #handleCopy({ filePath, association, config, fingerprint, size }) {
    let resolvedFingerprint = fingerprint ?? null;
    let resolvedSize = size;
    try {
      const ext = path.extname(filePath).toLowerCase();
      if (config.ignoredExtensions.includes(ext)) {
        return "skipped";
      }

      if (!resolvedFingerprint || resolvedSize === undefined) {
        const fingerprintResult = await fingerprintFile(filePath);
        resolvedFingerprint = fingerprintResult.fingerprint;
        resolvedSize = fingerprintResult.size;
      }
      const sourceRoot = association.input;
      const existing = await this.fileRepository.findByFingerprint(
        resolvedFingerprint,
        sourceRoot
      );
      if (existing?.status === "COPIED") {
        return "skipped";
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
        return "copied";
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
      return "copied";
    } catch (error) {
      if (error?.code === "ENOENT") {
        return "skipped";
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
      return "failed";
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

    await replaceDestination(tempPath, destinationPath);
    await cleanupTempDirectory(path.dirname(tempPath), path.join(destinationRoot, ".tmp"));
  }
}

async function replaceDestination(tempPath, destinationPath) {
  try {
    await fs.promises.unlink(destinationPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  await fs.promises.rename(tempPath, destinationPath);
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
