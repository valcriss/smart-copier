import { describe, expect, it, vi } from "vitest";

describe("main", () => {
  it("mounts the app", async () => {
    const mount = vi.fn();
    vi.resetModules();
    vi.doMock("vue", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        createApp: () => ({ mount })
      };
    });

    await import("../src/main.js");
    expect(mount).toHaveBeenCalledWith("#app");
  });
});
