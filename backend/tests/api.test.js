import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildApiRouter } from "../src/routes/api.js";
import express from "express";
import { RuntimeState } from "../src/services/runtimeState.js";
import fs from "fs";
import path from "path";

function createApp(deps) {
  const app = express();
  app.use(express.json());
  app.use("/api", buildApiRouter(deps));
  return app;
}

describe("API routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns config", async () => {
    const readdirSpy = vi
      .spyOn(fs.promises, "readdir")
      .mockResolvedValueOnce([
        { name: "alpha", isDirectory: () => true },
        { name: "alpha.txt", isDirectory: () => false }
      ])
      .mockResolvedValueOnce([{ name: "alpha-child", isDirectory: () => true }])
      .mockResolvedValueOnce([{ name: "beta", isDirectory: () => true }])
      .mockResolvedValueOnce([{ name: "beta-child", isDirectory: () => true }]);
    const runtimeState = new RuntimeState();
    const app = createApp({
      associationService: { getEffectiveConfig: async () => ({ associations: [] }) },
      watcherService: { start: vi.fn(), stop: vi.fn(), rescanAll: vi.fn() },
      runtimeState,
      fileRepository: { listHistory: async () => [] },
      envConfig: {
        getAllowedSourceRoots: () => ["/sources"],
        getAllowedDestinationRoots: () => ["/destinations"]
      },
      broadcaster: { addClient: vi.fn(), broadcast: vi.fn() }
    });

    const response = await request(app).get("/api/config");
    expect(response.status).toBe(200);
    expect(response.body.allowedRoots.source).toEqual([
      path.posix.join("/sources", "alpha"),
      path.posix.join("/sources", "alpha", "alpha-child")
    ]);
    expect(response.body.allowedRoots.destination).toEqual([
      path.posix.join("/destinations", "beta"),
      path.posix.join("/destinations", "beta", "beta-child")
    ]);
    expect(readdirSpy).toHaveBeenCalledTimes(4);
  });

  it("ignores nested listing errors", async () => {
    const readdirSpy = vi
      .spyOn(fs.promises, "readdir")
      .mockResolvedValueOnce([{ name: "alpha", isDirectory: () => true }])
      .mockRejectedValueOnce(new Error("nested missing"));
    const runtimeState = new RuntimeState();
    const app = createApp({
      associationService: { getEffectiveConfig: async () => ({ associations: [] }) },
      watcherService: { start: vi.fn(), stop: vi.fn(), rescanAll: vi.fn() },
      runtimeState,
      fileRepository: { listHistory: async () => [] },
      envConfig: {
        getAllowedSourceRoots: () => ["/sources"],
        getAllowedDestinationRoots: () => []
      },
      broadcaster: { addClient: vi.fn(), broadcast: vi.fn() }
    });

    const response = await request(app).get("/api/config");
    expect(response.status).toBe(200);
    expect(response.body.allowedRoots.source).toEqual([path.posix.join("/sources", "alpha")]);
    expect(readdirSpy).toHaveBeenCalledTimes(2);
  });

  it("handles missing roots", async () => {
    vi.spyOn(fs.promises, "readdir").mockRejectedValueOnce(new Error("missing"));
    const runtimeState = new RuntimeState();
    const app = createApp({
      associationService: { getEffectiveConfig: async () => ({ associations: [] }) },
      watcherService: { start: vi.fn(), stop: vi.fn(), rescanAll: vi.fn() },
      runtimeState,
      fileRepository: { listHistory: async () => [] },
      envConfig: {
        getAllowedSourceRoots: () => ["/sources"],
        getAllowedDestinationRoots: () => []
      },
      broadcaster: { addClient: vi.fn(), broadcast: vi.fn() }
    });

    const response = await request(app).get("/api/config");
    expect(response.status).toBe(200);
    expect(response.body.allowedRoots.source).toEqual([]);
  });

  it("updates config", async () => {
    const runtimeState = new RuntimeState();
    const watcherService = { start: vi.fn(), stop: vi.fn(), rescanAll: vi.fn() };
    const updateConfig = vi.fn(async () => ({
      associations: [{ id: "a", input: "/sources/project-a", output: "/destinations/project-b" }]
    }));
    const app = createApp({
      associationService: {
        getEffectiveConfig: async () => ({ associations: [] }),
        updateConfig
      },
      watcherService,
      runtimeState,
      fileRepository: { listHistory: async () => [] },
      envConfig: {
        getAllowedSourceRoots: () => ["/sources"],
        getAllowedDestinationRoots: () => ["/destinations"],
        resolveConfig: (stored) => stored
      },
      broadcaster: { addClient: vi.fn(), broadcast: vi.fn() }
    });

    const response = await request(app)
      .put("/api/config")
      .send({
        associations: [{ id: "a", input: "/sources/project-a", output: "/destinations/project-b" }]
      });

    expect(response.status).toBe(200);
    expect(response.body.config.associations.length).toBe(1);
    expect(updateConfig).toHaveBeenCalled();
    expect(watcherService.start).toHaveBeenCalled();
  });

  it("handles empty update body", async () => {
    const runtimeState = new RuntimeState();
    const updateConfig = vi.fn(async () => ({ associations: [] }));
    const app = createApp({
      associationService: {
        getEffectiveConfig: async () => ({ associations: [] }),
        updateConfig
      },
      watcherService: { start: vi.fn(), stop: vi.fn(), rescanAll: vi.fn() },
      runtimeState,
      fileRepository: { listHistory: async () => [] },
      envConfig: {
        getAllowedSourceRoots: () => ["/sources"],
        getAllowedDestinationRoots: () => ["/destinations"],
        resolveConfig: (stored) => stored
      },
      broadcaster: { addClient: vi.fn(), broadcast: vi.fn() }
    });

    const response = await request(app).put("/api/config");
    expect(response.status).toBe(200);
    expect(updateConfig).toHaveBeenCalledWith({});
  });

  it("passes empty payload when body is null", async () => {
    const runtimeState = new RuntimeState();
    const updateConfig = vi.fn(async () => ({ associations: [] }));
    const router = buildApiRouter({
      associationService: {
        getEffectiveConfig: async () => ({ associations: [] }),
        updateConfig
      },
      watcherService: { start: vi.fn(), stop: vi.fn(), rescanAll: vi.fn() },
      runtimeState,
      fileRepository: { listHistory: async () => [] },
      envConfig: {
        getAllowedSourceRoots: () => ["/sources"],
        getAllowedDestinationRoots: () => ["/destinations"],
        resolveConfig: (stored) => stored
      },
      broadcaster: { addClient: vi.fn(), broadcast: vi.fn() }
    });

    let resolveRequest;
    const res = {
      statusCode: 0,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolveRequest();
      }
    };

    await new Promise((resolve, reject) => {
      resolveRequest = resolve;
      router.handle({ method: "PUT", url: "/config", body: null }, res, (err) => {
        if (err) {
          reject(err);
        }
      });
    });
    expect(updateConfig).toHaveBeenCalledWith({});
    expect(res.body.config.associations).toEqual([]);
  });

  it("handles config errors", async () => {
    const runtimeState = new RuntimeState();
    const app = createApp({
      associationService: {
        getEffectiveConfig: async () => ({ associations: [] }),
        updateConfig: async () => {
          throw new Error("bad config");
        }
      },
      watcherService: { start: vi.fn(), stop: vi.fn(), rescanAll: vi.fn() },
      runtimeState,
      fileRepository: { listHistory: async () => [] },
      envConfig: {
        getAllowedSourceRoots: () => ["/sources"],
        getAllowedDestinationRoots: () => ["/destinations"],
        resolveConfig: (stored) => stored
      },
      broadcaster: { addClient: vi.fn(), broadcast: vi.fn() }
    });

    const response = await request(app).put("/api/config").send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("bad config");
  });

  it("returns status/history", async () => {
    const runtimeState = new RuntimeState();
    const watcherService = { start: vi.fn(), stop: vi.fn(), rescanAll: vi.fn() };
    const app = createApp({
      associationService: { getEffectiveConfig: async () => ({ associations: [] }) },
      watcherService,
      runtimeState,
      fileRepository: { listHistory: async () => [{ id: 1 }] },
      envConfig: {
        getAllowedSourceRoots: () => ["/sources"],
        getAllowedDestinationRoots: () => ["/destinations"]
      },
      broadcaster: { addClient: vi.fn(), broadcast: vi.fn() }
    });

    const statusResponse = await request(app).get("/api/status");
    const historyResponse = await request(app).get("/api/history");

    expect(statusResponse.body.running).toBe(false);
    expect(historyResponse.body.items.length).toBe(1);
  });

  it("opens SSE stream", () => {
    const runtimeState = new RuntimeState();
    const broadcaster = { addClient: vi.fn(), broadcast: vi.fn() };
    const router = buildApiRouter({
      associationService: { getEffectiveConfig: async () => ({ associations: [] }) },
      watcherService: { start: vi.fn(), stop: vi.fn(), rescanAll: vi.fn() },
      runtimeState,
      fileRepository: { listHistory: async () => [] },
      envConfig: {
        getAllowedSourceRoots: () => ["/sources"],
        getAllowedDestinationRoots: () => ["/destinations"]
      },
      broadcaster
    });

    const layer = router.stack.find((item) => item.route?.path === "/events");
    const handler = layer.route.stack[0].handle;
    const res = {
      headers: {},
      statusCode: 0,
      body: "",
      writeHead(status, headers) {
        this.statusCode = status;
        this.headers = headers;
      },
      write(chunk) {
        this.body += chunk;
      },
      on() {}
    };

    handler({}, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: state");
    expect(broadcaster.addClient).toHaveBeenCalled();
  });
});
