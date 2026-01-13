import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";
import { CopyService } from "../src/services/copyService.js";
import { RuntimeState } from "../src/services/runtimeState.js";
import * as fingerprintModule from "../src/util/fingerprint.js";

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smart-copier-"));
}

function createFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

class MemoryFileRepository {
  constructor() {
    this.files = new Map();
    this.events = [];
  }

  async findByFingerprint(fingerprint, sourceRoot) {
    return this.files.get(`${fingerprint}:${sourceRoot}`) ?? null;
  }

  async insertPending(file) {
    this.events.push({ type: "insert", file });
    this.files.set(`${file.fingerprint}:${file.sourceRoot}`, {
      fingerprint: file.fingerprint,
      source_root: file.sourceRoot,
      status: file.status,
      destination_path: file.destinationPath,
      error_message: null
    });
  }

  async markCopying(fingerprint, sourceRoot) {
    const entry = this.files.get(`${fingerprint}:${sourceRoot}`);
    if (entry) {
      entry.status = "COPYING";
    }
    this.events.push({ type: "copying" });
  }

  async markCopied(fingerprint, sourceRoot, destinationPath) {
    const entry = this.files.get(`${fingerprint}:${sourceRoot}`);
    if (entry) {
      entry.status = "COPIED";
      entry.destination_path = destinationPath;
    }
    this.events.push({ type: "copied" });
  }

  async markFailed(fingerprint, sourceRoot, errorMessage) {
    const entry = this.files.get(`${fingerprint}:${sourceRoot}`);
    if (entry) {
      entry.status = "FAILED";
      entry.error_message = errorMessage;
    }
    this.events.push({ type: "failed", errorMessage });
  }
}

function createService(repo, runtimeState) {
  return new CopyService({
    fileRepository: repo,
    envConfig: { getStabilityWindowSeconds: () => 0 },
    runtimeState,
    broadcaster: { broadcast: () => {} }
  });
}

describe("CopyService", () => {
  it("skips ignored extensions", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.tmp");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [".tmp"], dryRun: false }
    );

    expect(result).toBe("skipped");
    expect(fs.existsSync(path.join(destRoot, "file.tmp"))).toBe(false);
  });

  it("skips missing source files", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(destRoot, { recursive: true });

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const fingerprintSpy = vi
      .spyOn(fingerprintModule, "fingerprintFile")
      .mockRejectedValue({ code: "ENOENT" });

    const result = await copyService.enqueueCopy(
      path.join(sourceRoot, "missing.txt"),
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    expect(result).toBe("skipped");
    expect(runtimeState.logs.length).toBe(0);
    fingerprintSpy.mockRestore();
  });

  it("skips already copied files", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const fingerprint = await fingerprintModule.fingerprintFile(filePath);
    repo.files.set(`${fingerprint.fingerprint}:${sourceRoot}`, {
      status: "COPIED",
      source_root: sourceRoot
    });

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false },
      fingerprint.fingerprint,
      fingerprint.size
    );

    expect(result).toBe("skipped");
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(false);
  });

  it("handles dry run", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: true }
    );

    expect(result).toBe("copied");
    expect(repo.events.some((event) => event.type === "copied")).toBe(true);
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(false);
  });

  it("copies files and cleans temp", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "nested", "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    const destinationFile = path.join(destRoot, "nested", "file.txt");
    expect(result).toBe("copied");
    expect(fs.existsSync(destinationFile)).toBe(true);
    expect(fs.existsSync(path.join(destRoot, ".tmp"))).toBe(false);
  });

  it("overwrites existing destination files", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "new");
    const destinationFile = path.join(destRoot, "file.txt");
    createFile(destinationFile, "old");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    expect(result).toBe("copied");
    expect(fs.readFileSync(destinationFile, "utf8")).toBe("new");
  });

  it("fails when destination cannot be removed", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const unlinkSpy = vi
      .spyOn(fs.promises, "unlink")
      .mockRejectedValueOnce({ code: "EACCES" });

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    expect(result).toBe("failed");
    expect(runtimeState.logs[0].message).toBe("Unknown error");
    unlinkSpy.mockRestore();
  });

  it("keeps temp root when other temp files exist", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "nested", "file.txt");
    createFile(filePath, "content");
    const tempRoot = path.join(destRoot, ".tmp");
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "keep.partial"), "keep");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    expect(result).toBe("copied");
    expect(fs.existsSync(path.join(destRoot, ".tmp"))).toBe(true);
    expect(fs.existsSync(path.join(destRoot, ".tmp", "keep.partial"))).toBe(true);
  });

  it("marks failed copies and logs errors", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const renameSpy = vi
      .spyOn(fs.promises, "rename")
      .mockRejectedValue(new Error("rename failed"));

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    expect(result).toBe("failed");
    expect(repo.events.some((event) => event.type === "failed")).toBe(true);
    expect(runtimeState.logs[0].message).toBe("rename failed");
    renameSpy.mockRestore();
  });

  it("handles non-error failures", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    repo.findByFingerprint = async () => {
      throw "boom";
    };
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    expect(result).toBe("failed");
    expect(runtimeState.logs[0].message).toBe("Unknown error");
  });

  it("covers zero-byte progress branch", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "empty.txt");
    createFile(filePath, "");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const fingerprintSpy = vi
      .spyOn(fingerprintModule, "fingerprintFile")
      .mockResolvedValue({ fingerprint: "fp-zero", size: 0 });

    const reader = new EventEmitter();
    const writer = new EventEmitter();
    reader.pipe = () => {
      reader.emit("data", Buffer.alloc(0));
      writer.emit("close");
    };

    const readSpy = vi.spyOn(fs, "createReadStream").mockReturnValue(reader);
    const writeSpy = vi.spyOn(fs, "createWriteStream").mockReturnValue(writer);

    const copyService = createService(repo, runtimeState);
    await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    fingerprintSpy.mockRestore();
    readSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("handles processing when already busy", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    copyService.processing = true;
    const promise = copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(copyService.queue.length).toBe(1);
    copyService.queue[0].resolve("skipped");
    await promise;
  });

  it("handles empty queue shift", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const originalShift = copyService.queue.shift.bind(copyService.queue);
    copyService.queue.shift = () => undefined;
    const promise = copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(copyService.processing).toBe(false);
    copyService.queue.shift = originalShift;
    copyService.queue[0].resolve("skipped");
    await promise;
  });

  it("processes queued files sequentially", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath1 = path.join(sourceRoot, "file1.txt");
    const filePath2 = path.join(sourceRoot, "file2.txt");
    createFile(filePath1, "content");
    createFile(filePath2, "content-2");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const first = copyService.enqueueCopy(
      filePath1,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );
    const second = copyService.enqueueCopy(
      filePath2,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );
    await Promise.all([first, second]);

    expect(fs.existsSync(path.join(destRoot, "file1.txt"))).toBe(true);
    expect(fs.existsSync(path.join(destRoot, "file2.txt"))).toBe(true);
  });

  it("ignores cleanup errors", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);
    const copyService = createService(repo, runtimeState);

    const readdirSpy = vi
      .spyOn(fs.promises, "readdir")
      .mockRejectedValue(new Error("boom"));

    const result = await copyService.enqueueCopy(
      filePath,
      { id: "a", input: sourceRoot, output: destRoot },
      { ignoredExtensions: [], dryRun: false }
    );

    expect(result).toBe("copied");
    readdirSpy.mockRestore();
  });
});
