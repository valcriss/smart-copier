import { describe, expect, it } from "vitest";
import { AssociationService } from "../src/services/associationService.js";

class MemoryConfigRepo {
  constructor() {
    this.config = null;
  }
  async getConfig() {
    return this.config;
  }
  async setConfig(config) {
    this.config = config;
  }
}

describe("AssociationService", () => {
  it("resolves config", async () => {
    const repo = new MemoryConfigRepo();
    repo.config = { associations: [] };
    const envConfig = { resolveConfig: (stored) => ({ ...stored, scanIntervalSeconds: 10 }) };
    const service = new AssociationService({ configRepository: repo, envConfig });

    const config = await service.getEffectiveConfig();
    expect(config.scanIntervalSeconds).toBe(10);
  });

  it("validates roots", async () => {
    const repo = new MemoryConfigRepo();
    const envConfig = {
      getAllowedSourceRoots: () => ["/sources"],
      getAllowedDestinationRoots: () => ["/destinations"]
    };
    const service = new AssociationService({ configRepository: repo, envConfig });

    await service.updateConfig({
      associations: [
        { id: "a", input: "/sources/project-a", output: "/destinations/project-b" }
      ]
    });
    expect(repo.config.associations.length).toBe(1);

    await expect(
      service.updateConfig({ associations: [{ id: "b", input: "/bad", output: "/destinations" }] })
    ).rejects.toThrow("outside allowed roots");

    await expect(
      service.updateConfig({ associations: [{ id: "c", input: "/sources", output: "/bad" }] })
    ).rejects.toThrow("subdirectory of allowed roots");

    await expect(
      service.updateConfig({
        associations: [{ id: "d", input: "/sources", output: "/destinations" }]
      })
    ).rejects.toThrow("subdirectory of allowed roots");

    await expect(
      service.updateConfig({
        associations: [{ id: "e", input: "/sources/project", output: "/destinations" }]
      })
    ).rejects.toThrow("subdirectory of allowed roots");

    await expect(
      service.updateConfig({
        associations: [{ id: "f", input: "/sources/project", output: "/bad" }]
      })
    ).rejects.toThrow("outside allowed roots");
  });

  it("handles empty associations", async () => {
    const repo = new MemoryConfigRepo();
    const envConfig = {
      getAllowedSourceRoots: () => ["/sources"],
      getAllowedDestinationRoots: () => ["/destinations"]
    };
    const service = new AssociationService({ configRepository: repo, envConfig });

    await service.updateConfig({});
    expect(repo.config.associations).toEqual([]);
  });
});
