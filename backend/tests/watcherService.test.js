import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { WatcherService } from "../src/services/watcherService.js";
import { RuntimeState } from "../src/services/runtimeState.js";
import { fingerprintFile } from "../src/util/fingerprint.js";

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smart-copier-"));
}

function createFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

class MemoryFileRepository {
  constructor() {
    this.copied = new Set();
  }

  async findByFingerprint(fingerprint, sourceRoot) {
    if (this.copied.has(`${fingerprint}:${sourceRoot}`)) {
      return { status: "COPIED" };
    }
    return null;
  }
}

describe("WatcherService", () => {
  let runtimeState;
  let copyService;
  let broadcaster;
  let fileRepository;
  let inputRoot;
  let outputRoot;
  let association;
  let config;

  beforeEach(() => {
    runtimeState = new RuntimeState();
    copyService = { enqueueCopy: vi.fn(async () => "copied") };
    broadcaster = { broadcast: vi.fn() };
    fileRepository = new MemoryFileRepository();
    inputRoot = createTempDir();
    outputRoot = createTempDir();
    association = { id: "a", input: inputRoot, output: outputRoot };
    config = {
      scanIntervalSeconds: 1,
      ignoredExtensions: [],
      dryRun: false
    };
    runtimeState.setAssociations([association]);
  });

  it("starts and stops scanning", () => {
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    service.start([association], config);
    expect(runtimeState.running).toBe(true);
    expect(runtimeState.taskStatus).toBe("running");

    service.stop();
    expect(runtimeState.running).toBe(false);
  });

  it("transitions pending to copy and enqueues", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, config);
    expect(runtimeState.associations[0].pendingCount).toBe(1);
    expect(runtimeState.associations[0].toCopyCount).toBe(0);

    await service.scanAssociation(association, config);
    await new Promise((resolve) => setImmediate(resolve));

    expect(copyService.enqueueCopy).toHaveBeenCalledTimes(1);
    expect(runtimeState.associations[0].pendingCount).toBe(0);
    expect(runtimeState.associations[0].toCopyCount).toBe(0);
  });

  it("ignores temporary extensions", async () => {
    const filePath = path.join(inputRoot, "file.tmp");
    createFile(filePath, "content");
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, {
      ...config,
      ignoredExtensions: [".tmp"]
    });

    expect(copyService.enqueueCopy).not.toHaveBeenCalled();
    expect(runtimeState.associations[0].pendingCount).toBe(0);
    expect(runtimeState.associations[0].toCopyCount).toBe(0);
  });

  it("skips already copied files", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    const fingerprint = await fingerprintFile(filePath);
    fileRepository.copied.add(`${fingerprint.fingerprint}:${inputRoot}`);

    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, config);
    await service.scanAssociation(association, config);
    await new Promise((resolve) => setImmediate(resolve));

    expect(copyService.enqueueCopy).not.toHaveBeenCalled();
    expect(runtimeState.associations[0].pendingCount).toBe(0);
    expect(runtimeState.associations[0].toCopyCount).toBe(0);
  });

  it("updates ignored files when size changes", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    const fingerprint = await fingerprintFile(filePath);
    fileRepository.copied.add(`${fingerprint.fingerprint}:${inputRoot}`);

    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, config);
    await service.scanAssociation(association, config);
    fs.appendFileSync(filePath, "more");
    await service.scanAssociation(association, config);

    expect(runtimeState.associations[0].pendingCount).toBe(1);
  });

  it("keeps pending when size changes", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, config);
    fs.appendFileSync(filePath, "more");
    await service.scanAssociation(association, config);

    expect(runtimeState.associations[0].pendingCount).toBe(1);
  });

  it("resets to pending when to-copy file changes", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    const state = new Map();
    state.set(filePath, {
      size: 1,
      lastCheckedAt: Date.now(),
      status: "to_copy",
      inFlight: false
    });
    service.fileStates.set(association.id, state);
    fs.appendFileSync(filePath, "more");

    await service.scanAssociation(association, config);

    expect(runtimeState.associations[0].pendingCount).toBe(1);
  });

  it("records copy errors", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    copyService.enqueueCopy = vi.fn(async () => {
      throw new Error("copy failed");
    });

    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, config);
    await service.scanAssociation(association, config);
    await new Promise((resolve) => setImmediate(resolve));

    expect(runtimeState.taskStatus).toBe("error");
    expect(runtimeState.logs[0].message).toBe("copy failed");
  });

  it("walks nested directories", async () => {
    const nestedDir = path.join(inputRoot, "nested");
    const filePath = path.join(nestedDir, "file.txt");
    createFile(filePath, "content");

    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, config);

    expect(runtimeState.associations[0].pendingCount).toBe(1);
  });

  it("updates existing ignored entries", async () => {
    const filePath = path.join(inputRoot, "file.tmp");
    createFile(filePath, "content");
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    const ignoredConfig = { ...config, ignoredExtensions: [".tmp"] };
    await service.scanAssociation(association, ignoredConfig);
    await service.scanAssociation(association, ignoredConfig);

    expect(runtimeState.associations[0].pendingCount).toBe(0);
  });

  it("throws on unexpected stat errors", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    const statSpy = vi
      .spyOn(fs.promises, "stat")
      .mockRejectedValueOnce(new Error("boom"));

    await expect(service.scanAssociation(association, config)).rejects.toThrow("boom");
    statSpy.mockRestore();
  });

  it("removes deleted files from state", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, config);
    fs.unlinkSync(filePath);
    await service.scanAssociation(association, config);

    const state = service.fileStates.get(association.id);
    expect(state?.size ?? 0).toBe(0);
  });

  it("handles ENOENT during stat", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    const statSpy = vi
      .spyOn(fs.promises, "stat")
      .mockRejectedValueOnce({ code: "ENOENT" });

    await service.scanAssociation(association, config);
    expect(runtimeState.associations[0].pendingCount).toBe(0);
    statSpy.mockRestore();
  });

  it("logs scan errors on start and interval", async () => {
    vi.useFakeTimers();
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });
    const scanSpy = vi
      .spyOn(service, "scanAssociation")
      .mockRejectedValueOnce(new Error("scan fail"))
      .mockRejectedValueOnce(new Error("interval fail"));

    service.start([association], { ...config, scanIntervalSeconds: 1 });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(runtimeState.logs.length).toBe(2);
    expect(runtimeState.logs[0].message).toBe("interval fail");
    expect(runtimeState.taskStatus).toBe("error");

    service.stop();
    scanSpy.mockRestore();
    vi.useRealTimers();
  });

  it("logs scan errors with fallback message", async () => {
    vi.useFakeTimers();
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });
    const scanSpy = vi
      .spyOn(service, "scanAssociation")
      .mockRejectedValueOnce({})
      .mockRejectedValueOnce({});

    service.start([association], { ...config, scanIntervalSeconds: 1 });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(runtimeState.logs.length).toBe(2);
    expect(runtimeState.logs[0].message).toBe("Scan error");

    service.stop();
    scanSpy.mockRestore();
    vi.useRealTimers();
  });

  it("keeps to-copy status on failed copy result", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    copyService.enqueueCopy = vi.fn(async () => "failed");

    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, config);
    await service.scanAssociation(association, config);
    await new Promise((resolve) => setImmediate(resolve));

    expect(runtimeState.associations[0].toCopyCount).toBe(1);
  });

  it("logs copy errors with fallback message", async () => {
    const filePath = path.join(inputRoot, "file.txt");
    createFile(filePath, "content");
    copyService.enqueueCopy = vi.fn(async () => {
      throw {};
    });

    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });

    await service.scanAssociation(association, config);
    await service.scanAssociation(association, config);
    await new Promise((resolve) => setImmediate(resolve));

    expect(runtimeState.logs[0].message).toBe("Copy error");
  });

  it("rescans all associations", async () => {
    const secondAssociation = {
      id: "b",
      input: createTempDir(),
      output: createTempDir()
    };
    runtimeState.setAssociations([association, secondAssociation]);
    const service = new WatcherService({
      copyService,
      runtimeState,
      broadcaster,
      fileRepository
    });
    const scanSpy = vi.spyOn(service, "scanAssociation").mockResolvedValue();

    await service.rescanAll(config);

    expect(scanSpy).toHaveBeenCalledTimes(2);
  });
});
