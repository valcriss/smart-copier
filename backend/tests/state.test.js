import { describe, expect, it, vi } from "vitest";
import { RuntimeState } from "../src/services/runtimeState.js";
import { createSseBroadcaster } from "../src/sse/broadcaster.js";
import { createLogger } from "../src/logger.js";
import { EventEmitter } from "events";

describe("RuntimeState", () => {
  it("tracks associations and logs", () => {
    const state = new RuntimeState();
    state.setAssociations([{ id: "a", input: "/sources/a", output: "/destinations/b" }]);
    state.setRunning(true);
    state.setTaskStatus("error");
    state.setAssociationStatus("a", "copying", { filename: "file.txt" });
    state.setAssociationPendingCount("a", 2);
    state.setAssociationToCopyCount("a", 1);
    state.addLog({ level: "info", message: "ok" });

    const snapshot = state.snapshot();
    expect(snapshot.running).toBe(true);
    expect(snapshot.taskStatus).toBe("error");
    expect(snapshot.associations[0].status).toBe("copying");
    expect(snapshot.associations[0].pendingCount).toBe(2);
    expect(snapshot.associations[0].toCopyCount).toBe(1);
    expect(snapshot.logs.length).toBe(1);
  });

  it("caps logs", () => {
    const state = new RuntimeState();
    for (let i = 0; i < 205; i += 1) {
      state.addLog({ level: "info", message: `log-${i}` });
    }
    expect(state.logs.length).toBe(200);
  });

  it("ignores unknown associations", () => {
    const state = new RuntimeState();
    state.setAssociations([{ id: "a", input: "/sources/a", output: "/destinations/b" }]);
    state.setAssociationStatus("missing", "copying", { filename: "x" });
    state.setAssociationPendingCount("missing", 3);
    state.setAssociationToCopyCount("missing", 2);
    expect(state.associations[0].status).toBe("idle");
    expect(state.associations[0].pendingCount).toBe(0);
    expect(state.associations[0].toCopyCount).toBe(0);
  });
});

describe("SSE broadcaster", () => {
  it("broadcasts to clients", () => {
    const broadcaster = createSseBroadcaster();
    const emitter = new EventEmitter();
    const writes = [];
    emitter.write = (chunk) => writes.push(chunk);
    broadcaster.addClient(emitter);
    broadcaster.broadcast("state", { running: false });
    expect(writes[0]).toContain("event: state");
    expect(writes[0]).toContain("running");
    emitter.emit("close");
    broadcaster.broadcast("state", { running: true });
    expect(writes.length).toBe(1);
  });
});

describe("logger", () => {
  it("writes structured logs", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logger = createLogger("test");
    logger.info("hello", { id: 1 });
    logger.error("oops");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
