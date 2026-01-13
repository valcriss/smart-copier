import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const deps = {
  associationService: { getEffectiveConfig: async () => ({ associations: [] }) },
  watcherService: { start: () => {}, stop: () => {}, rescanAll: () => {} },
  runtimeState: { snapshot: () => ({ running: false }) },
  fileRepository: { listHistory: async () => [] },
  envConfig: {
    getAllowedSourceRoots: () => ["/sources"],
    getAllowedDestinationRoots: () => ["/destinations"],
    resolveConfig: (stored) => stored
  },
  broadcaster: { addClient: () => {}, broadcast: () => {} }
};

describe("app", () => {
  it("serves index fallback", async () => {
    const app = createApp(deps);
    const response = await request(app).get("/missing");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Smart Copier");
  });
});
