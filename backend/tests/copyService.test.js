import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { CopyService } from "../src/services/copyService.js";
import { RuntimeState } from "../src/services/runtimeState.js";
import { fingerprintFile } from "../src/util/fingerprint.js";
import * as fingerprintModule from "../src/util/fingerprint.js";
import { EventEmitter } from "events";

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
  }

  async findByFingerprint(fingerprint, sourceRoot) {
    return this.files.get(`${fingerprint}:${sourceRoot}`);
  }

  async insertPending(file) {
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
    entry.status = "COPYING";
  }

  async markCopied(fingerprint, sourceRoot, destinationPath) {
    const entry = this.files.get(`${fingerprint}:${sourceRoot}`);
    entry.status = "COPIED";
    entry.destination_path = destinationPath;
  }

  async markFailed(fingerprint, sourceRoot, errorMessage) {
    const entry = this.files.get(`${fingerprint}:${sourceRoot}`);
    entry.status = "FAILED";
    entry.error_message = errorMessage;
  }
}

describe("CopyService", () => {
  it("skips ignored extensions", async () => {
    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: "/in", output: "/out" }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue("/in/file.tmp", { id: "a", input: "/in", output: "/out" }, {
      ignoredExtensions: [".tmp"],
      dryRun: false
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtimeState.associations[0].status).toBe("idle");
  });

  it("ignores ENOENT during enqueue", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const fingerprintSpy = vi
      .spyOn(fingerprintModule, "fingerprintFile")
      .mockRejectedValue({ code: "ENOENT" });

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await flushAsync();

    expect(runtimeState.associations[0].status).toBe("idle");
    expect(runtimeState.logs.length).toBe(0);
    fingerprintSpy.mockRestore();
  });

  it("skips ignored extensions in handler", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.tmp");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    copyService.queue.push({
      filePath,
      association: { id: "a", input: sourceRoot, output: destRoot },
      config: { ignoredExtensions: [".tmp"], dryRun: false }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    expect(fs.existsSync(path.join(destRoot, "file.tmp"))).toBe(false);
  });

  it("computes fingerprint in handler when missing", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath1 = path.join(sourceRoot, "file1.txt");
    const filePath2 = path.join(sourceRoot, "file2.txt");
    createFile(filePath1, "content-1");
    createFile(filePath2, "content-2");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    copyService.queue.push({
      filePath: filePath1,
      association: { id: "a", input: sourceRoot, output: destRoot },
      config: { ignoredExtensions: [], dryRun: false }
    });

    await copyService.enqueue(filePath2, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: true
    });

    await waitForFile(path.join(destRoot, "file1.txt"));
    expect(fs.existsSync(path.join(destRoot, "file1.txt"))).toBe(true);
  });

  it("skips already copied in handler", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath1 = path.join(sourceRoot, "file1.txt");
    const filePath2 = path.join(sourceRoot, "file2.txt");
    createFile(filePath1, "content-1");
    createFile(filePath2, "content-2");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const fingerprint = await fingerprintFile(filePath1);
    repo.files.set(`${fingerprint.fingerprint}:${sourceRoot}`, {
      status: "COPIED",
      source_root: sourceRoot
    });

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    copyService.queue.push({
      filePath: filePath1,
      association: { id: "a", input: sourceRoot, output: destRoot },
      config: { ignoredExtensions: [], dryRun: false }
    });

    await copyService.enqueue(filePath2, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: true
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fs.existsSync(path.join(destRoot, "file1.txt"))).toBe(false);
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

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    const result = await fingerprintFile(filePath);
    repo.files.set(`${result.fingerprint}:${sourceRoot}`, {
      status: "COPIED",
      source_root: sourceRoot
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
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

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: true
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(false);
  });

  it("copies files", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "nested", "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const destinationFile = path.join(destRoot, "nested", "file.txt");
    expect(fs.existsSync(destinationFile)).toBe(true);
    expect(fs.existsSync(path.join(destRoot, ".tmp"))).toBe(false);
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

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fs.existsSync(path.join(destRoot, ".tmp"))).toBe(true);
    expect(fs.existsSync(path.join(destRoot, ".tmp", "keep.partial"))).toBe(true);
    expect(fs.existsSync(path.join(destRoot, ".tmp", "nested"))).toBe(false);
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

    const readdirSpy = vi.spyOn(fs.promises, "readdir").mockRejectedValue(new Error("boom"));

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(true);
    readdirSpy.mockRestore();
  });

  it("marks errors", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const fingerprintSpy = vi
      .spyOn(fingerprintModule, "fingerprintFile")
      .mockRejectedValue(new Error("boom"));

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await flushAsync();
    await waitForCondition(() => runtimeState.associations[0].status === "error");
    expect(runtimeState.associations[0].status).toBe("error");
    fingerprintSpy.mockRestore();
  });

  it("marks failed copy", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const renameSpy = vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("rename failed"));

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await waitForCondition(() => Array.from(repo.files.values())[0]?.status === "FAILED");
    const stored = Array.from(repo.files.values())[0];
    expect(stored?.status).toBe("FAILED");
    renameSpy.mockRestore();
  });

  it("logs handler errors", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath1 = path.join(sourceRoot, "file1.txt");
    const filePath2 = path.join(sourceRoot, "file2.txt");
    createFile(filePath1, "content-1");
    createFile(filePath2, "content-2");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const targetFingerprint = await fingerprintFile(filePath1);
    repo.findByFingerprint = async (fingerprint) => {
      if (fingerprint === targetFingerprint.fingerprint) {
        throw new Error("boom");
      }
      return null;
    };
    repo.markFailed = async () => {};

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    copyService.queue.push({
      filePath: filePath1,
      association: { id: "a", input: sourceRoot, output: destRoot },
      config: { ignoredExtensions: [], dryRun: false }
    });

    await copyService.enqueue(filePath2, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: true
    });

    await waitForCondition(() => runtimeState.logs.length === 1);
    expect(runtimeState.logs[0].message).toBe("boom");
  });

  it("logs non-error handler errors", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath1 = path.join(sourceRoot, "file1.txt");
    const filePath2 = path.join(sourceRoot, "file2.txt");
    createFile(filePath1, "content-1");
    createFile(filePath2, "content-2");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const targetFingerprint = await fingerprintFile(filePath1);
    repo.findByFingerprint = async (fingerprint) => {
      if (fingerprint === targetFingerprint.fingerprint) {
        throw "boom";
      }
      return null;
    };
    repo.markFailed = async () => {};

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    copyService.queue.push({
      filePath: filePath1,
      association: { id: "a", input: sourceRoot, output: destRoot },
      config: { ignoredExtensions: [], dryRun: false }
    });

    await copyService.enqueue(filePath2, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: true
    });

    await waitForCondition(() => runtimeState.logs.length === 1);
    expect(runtimeState.logs[0].message).toBe("Unknown error");
  });

  it("skips processing when busy", async () => {
    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    copyService.processing = true;
    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await flushAsync();
    expect(copyService.queue.length).toBe(1);
  });

  it("handles empty queue shift", async () => {
    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    copyService.queue.shift = () => undefined;
    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await flushAsync();
    expect(copyService.processing).toBe(false);
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

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    const first = copyService.enqueue(filePath1, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    const second = copyService.enqueue(filePath2, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await Promise.all([first, second]);

    await waitForFile(path.join(destRoot, "file1.txt"));
    await waitForFile(path.join(destRoot, "file2.txt"));
    expect(fs.existsSync(path.join(destRoot, "file1.txt"))).toBe(true);
    expect(fs.existsSync(path.join(destRoot, "file2.txt"))).toBe(true);
  });

  it("handles zero-byte files", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "empty.txt");
    createFile(filePath, "");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await waitForFile(path.join(destRoot, "empty.txt"));
    expect(fs.existsSync(path.join(destRoot, "empty.txt"))).toBe(true);
  });

  it("handles non-error rejections", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    repo.findByFingerprint = async () => {
      throw "boom";
    };
    repo.markFailed = async () => {};

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await waitForCondition(() => runtimeState.logs.length === 1);
    expect(runtimeState.logs.length).toBe(1);
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

    const fingerprintSpy = vi.spyOn(fingerprintModule, "fingerprintFile").mockResolvedValue({
      fingerprint: "fp-zero",
      size: 0
    });

    const reader = new EventEmitter();
    reader.pipe = (writer) => {
      reader.emit("data", Buffer.alloc(0));
      writer.emit("close");
    };
    const writer = new EventEmitter();

    const readSpy = vi.spyOn(fs, "createReadStream").mockReturnValue(reader);
    const writeSpy = vi.spyOn(fs, "createWriteStream").mockReturnValue(writer);

    let progressCapture = null;
    const originalSetStatus = runtimeState.setAssociationStatus.bind(runtimeState);
    runtimeState.setAssociationStatus = (id, status, currentFile) => {
      if (currentFile) {
        progressCapture = currentFile;
      }
      originalSetStatus(id, status, currentFile);
    };

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(progressCapture).toBeTruthy();
    expect(progressCapture.percent).toBe(100);

    fingerprintSpy.mockRestore();
    readSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it("waits for stability window", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0.05 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await flushAsync();

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(false);

    fs.appendFileSync(filePath, "more");
    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await flushAsync();

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(true);
  });

  it("tracks verifying files per association", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0.05 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await flushAsync();
    expect(runtimeState.associations[0].verifyingCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(runtimeState.associations[0].verifyingCount).toBe(0);
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(true);
  });

  it("keeps verifying during stability window", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0.05 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await flushAsync();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await flushAsync();
    expect(runtimeState.associations[0].verifyingCount).toBe(1);
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(false);
  });

  it("resets stability timer on change", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0.05 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.appendFileSync(filePath, "more");

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(true);
  });

  it("reschedules stability when timer missing", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0.05 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await flushAsync();

    const entry = copyService.stability.get(filePath);
    entry.timer = null;
    entry.stableAt = Date.now() + 40;

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await flushAsync();

    expect(copyService.stability.get(filePath)?.timer).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(true);
  });

  it("clears stability timer on fire", async () => {
    vi.useFakeTimers();
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0.05 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await vi.advanceTimersByTimeAsync(60);
    const entry = copyService.stability.get(filePath);
    if (entry) {
      expect(entry.timer).toBe(null);
    }
    vi.useRealTimers();
  });

  it("clears existing timer when stable", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0.05 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
    }, 50);
    const stat = fs.statSync(filePath);
    copyService.stability.set(filePath, {
      lastSize: stat.size,
      lastMtime: stat.mtimeMs,
      stableAt: Date.now() - 1,
      timer
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fired).toBe(false);
  });

  it("clears stability on ignored extension", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0.05 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await flushAsync();
    expect(runtimeState.associations[0].verifyingCount).toBe(1);

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [".txt"],
      dryRun: false
    });
    await flushAsync();

    expect(runtimeState.associations[0].verifyingCount).toBe(0);
    expect(fs.existsSync(path.join(destRoot, "file.txt"))).toBe(false);
  });

  it("logs unexpected stat errors", async () => {
    const root = createTempDir();
    const sourceRoot = path.join(root, "src");
    const destRoot = path.join(root, "dst");
    const filePath = path.join(sourceRoot, "file.txt");
    createFile(filePath, "content");

    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: sourceRoot, output: destRoot }]);

    const statSpy = vi.spyOn(fs.promises, "stat").mockRejectedValueOnce(new Error("boom"));

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0.05 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue(filePath, { id: "a", input: sourceRoot, output: destRoot }, {
      ignoredExtensions: [],
      dryRun: false
    });
    await flushAsync();
    expect(runtimeState.associations[0].status).toBe("error");
    expect(runtimeState.logs[0].message).toBe("boom");
    statSpy.mockRestore();
  });

  it("ignores missing source files", async () => {
    const repo = new MemoryFileRepository();
    const runtimeState = new RuntimeState();
    runtimeState.setAssociations([{ id: "a", input: "/in", output: "/out" }]);

    const copyService = new CopyService({
      fileRepository: repo,
      envConfig: { getStabilityWindowSeconds: () => 0 },
      runtimeState,
      broadcaster: { broadcast: () => {} }
    });

    await copyService.enqueue("/in/missing.txt", { id: "a", input: "/in", output: "/out" }, {
      ignoredExtensions: [],
      dryRun: false
    });

    await flushAsync();
    expect(runtimeState.associations[0].status).toBe("idle");
    expect(runtimeState.logs.length).toBe(0);
  });
});

async function waitForFile(filePath, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitForCondition(predicate, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
