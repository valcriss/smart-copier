import { describe, expect, it } from "vitest";
import { applyState, connectSse, setConfig, state } from "../src/state.js";

function resetState() {
  state.running = false;
  state.associations = [];
  state.logs = [];
  state.config = {
    associations: [],
    ignoredExtensions: [],
    scanIntervalSeconds: 60,
    dryRun: false
  };
  state.allowedRoots = { source: [], destination: [] };
}

describe("state", () => {
  it("applies runtime state", () => {
    resetState();
    applyState({
      running: true,
      taskStatus: "error",
      associations: [{ id: "a" }],
      logs: [{ message: "x" }]
    });
    expect(state.running).toBe(true);
    expect(state.taskStatus).toBe("error");
    expect(state.associations.length).toBe(1);
    expect(state.logs.length).toBe(1);
  });

  it("uses default state fallbacks", () => {
    resetState();
    applyState({ running: false });
    expect(state.taskStatus).toBe("running");
    expect(state.associations).toEqual([]);
    expect(state.logs).toEqual([]);
  });

  it("sets config", () => {
    resetState();
    setConfig({ associations: [{ id: "a" }], ignoredExtensions: [], scanIntervalSeconds: 10, dryRun: true }, {
      source: ["/sources/project-a"],
      destination: ["/destinations/project-b"]
    });
    expect(state.config.dryRun).toBe(true);
    expect(state.allowedRoots.source[0]).toBe("/sources/project-a");
  });

  it("connects to SSE", () => {
    resetState();
    const listeners = {};
    const source = connectSse((url) => ({
      addEventListener: (event, handler) => {
        listeners[event] = handler;
      },
      url
    }));

    const payload = { running: true, associations: [], logs: [] };
    listeners.state({ data: JSON.stringify(payload) });
    expect(state.running).toBe(true);
    expect(source.url).toBe("/api/events");
  });

  it("uses default EventSource factory", () => {
    resetState();
    const originalEventSource = global.EventSource;
    global.EventSource = class {
      constructor(url) {
        this.url = url;
      }
      addEventListener() {}
    };

    const source = connectSse();
    expect(source.url).toBe("/api/events");

    global.EventSource = originalEventSource;
  });
});
