import { describe, expect, it, vi } from "vitest";
import {
  fetchConfig,
  fetchHistory,
  updateConfig
} from "../src/api.js";

function mockFetchOnce(response) {
  global.fetch = vi.fn().mockResolvedValue(response);
}

function createResponse(ok, data) {
  return {
    ok,
    json: async () => data
  };
}

describe("api", () => {
  it("fetches config", async () => {
    mockFetchOnce(createResponse(true, { config: {} }));
    const data = await fetchConfig();
    expect(data.config).toEqual({});
  });

  it("errors on config fetch", async () => {
    mockFetchOnce(createResponse(false, {}));
    await expect(fetchConfig()).rejects.toThrow("Failed to load config");
  });

  it("updates config", async () => {
    mockFetchOnce(createResponse(true, { config: { associations: [] } }));
    const data = await updateConfig({ associations: [] });
    expect(data.config.associations).toEqual([]);
  });

  it("errors on update", async () => {
    mockFetchOnce(createResponse(false, { error: "bad" }));
    await expect(updateConfig({})).rejects.toThrow("bad");
  });

  it("uses default update error message", async () => {
    mockFetchOnce(createResponse(false, {}));
    await expect(updateConfig({})).rejects.toThrow("Failed to update config");
  });

  it("fetches history", async () => {
    mockFetchOnce(createResponse(true, { items: [] }));
    const data = await fetchHistory();
    expect(data.items).toEqual([]);
  });

  it("errors on history", async () => {
    mockFetchOnce(createResponse(false, {}));
    await expect(fetchHistory()).rejects.toThrow("Failed to load history");
  });

});
