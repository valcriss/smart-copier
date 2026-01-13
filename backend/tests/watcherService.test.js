import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { WatcherService } from "../src/services/watcherService.js";
import { RuntimeState } from "../src/services/runtimeState.js";

const { watcherInstances, mockWatch } = vi.hoisted(() => {
  const watcherInstances = [];
  const mockWatch = vi.fn(() => {
    const handlers = {};
    const instance = {
      on: (event, cb) => {
        handlers[event] = cb;
        return instance;
      },
      close: vi.fn()
    };
    watcherInstances.push({ instance, handlers });
    return instance;
  });
  return { watcherInstances, mockWatch };
});

vi.mock("chokidar", () => ({ default: { watch: mockWatch } }));

describe("WatcherService", () => {
  let runtimeState;
  let copyService;
  let broadcaster;
  let outputRoot;

  beforeEach(() => {
    watcherInstances.length = 0;
    mockWatch.mockClear();
    runtimeState = new RuntimeState();
    copyService = { enqueue: vi.fn() };
    broadcaster = { broadcast: vi.fn() };
    outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smart-copier-out-"));
  });

  it("starts and stops watchers", () => {
    const service = new WatcherService({ copyService, runtimeState, broadcaster });
    service.start([{ id: "a", input: "/in", output: outputRoot }], {
      scanIntervalSeconds: 10
    });

    expect(mockWatch).toHaveBeenCalled();
    service.stop();
    expect(runtimeState.running).toBe(false);
  });

  it("marks error on watcher failure", () => {
    const service = new WatcherService({ copyService, runtimeState, broadcaster });
    service.start([{ id: "a", input: "/in", output: outputRoot }], {
      scanIntervalSeconds: 10
    });

    watcherInstances[0].handlers.error(new Error("boom"));
    expect(runtimeState.taskStatus).toBe("error");
    expect(runtimeState.logs.length).toBe(1);
  });

  it("uses fallback error message", () => {
    const service = new WatcherService({ copyService, runtimeState, broadcaster });
    service.start([{ id: "a", input: "/in", output: outputRoot }], {
      scanIntervalSeconds: 10
    });

    watcherInstances[0].handlers.error({});
    expect(runtimeState.logs[0].message).toBe("Watcher error");
  });

  it("handles file events and interval", async () => {
    vi.useFakeTimers();
    const service = new WatcherService({ copyService, runtimeState, broadcaster });
    const rescanSpy = vi.spyOn(service, "rescanAssociation").mockResolvedValue();
    service.start([{ id: "a", input: "/in", output: outputRoot }], {
      scanIntervalSeconds: 1
    });

    watcherInstances[0].handlers.add("/in/file.txt");
    watcherInstances[0].handlers.change("/in/file.txt");
    watcherInstances[0].handlers.addDir("/in/nested");
    expect(copyService.enqueue).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(rescanSpy).toHaveBeenCalled();

    service.stop();
    vi.useRealTimers();
  });

  it("ignores root addDir events", () => {
    const mkdirSpy = vi.spyOn(fs.promises, "mkdir").mockResolvedValue();
    const service = new WatcherService({ copyService, runtimeState, broadcaster });
    const rescanSpy = vi.spyOn(service, "rescanAssociation").mockResolvedValue();
    service.start([{ id: "a", input: "/in", output: outputRoot }], {
      scanIntervalSeconds: 10
    });

    watcherInstances[0].handlers.addDir("/in");
    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(rescanSpy).toHaveBeenCalled();

    service.stop();
    mkdirSpy.mockRestore();
  });

  it("rescans directories", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "smart-copier-"));
    const filePath = path.join(root, "file.txt");
    const nestedDir = path.join(root, "nested");
    const nestedFile = path.join(nestedDir, "file2.txt");
    fs.writeFileSync(filePath, "data");
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(nestedFile, "data");

    const service = new WatcherService({ copyService, runtimeState, broadcaster });
    runtimeState.setAssociations([{ id: "a", input: root, output: outputRoot }]);

    await service.rescanAll({ scanIntervalSeconds: 10 });
    expect(copyService.enqueue).toHaveBeenCalledWith(filePath, expect.anything(), expect.anything());
    expect(copyService.enqueue).toHaveBeenCalledWith(nestedFile, expect.anything(), expect.anything());
    expect(fs.existsSync(path.join(outputRoot, "nested"))).toBe(true);
  });
});
