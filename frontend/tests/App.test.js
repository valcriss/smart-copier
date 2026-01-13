import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import App from "../src/App.vue";

const apiMocks = vi.hoisted(() => ({
  fetchConfig: vi.fn(async () => ({
    config: { associations: [], ignoredExtensions: [], scanIntervalSeconds: 10, dryRun: false },
    allowedRoots: { source: ["/sources/project-a"], destination: ["/destinations/project-b"] }
  })),
  fetchHistory: vi.fn(async () => ({ items: [] }))
}));

vi.mock("../src/api.js", () => apiMocks);

const stateMocks = vi.hoisted(() => ({
  connectSse: vi.fn(() => ({ close: vi.fn() }))
}));

vi.mock("../src/state.js", async () => {
  const actual = await vi.importActual("../src/state.js");
  return {
    ...actual,
    connectSse: stateMocks.connectSse
  };
});

describe("App", () => {
  it("renders navigation and tabs", async () => {
    const wrapper = mount(App);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain("Dashboard");
    expect(wrapper.text()).toContain("Historique");
    expect(wrapper.text()).toContain("Logs");
    expect(stateMocks.connectSse).toHaveBeenCalled();
    const state = (await import("../src/state.js")).state;
    state.running = true;
    state.taskStatus = "running";
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("running");

    const buttons = wrapper.findAll("button");
    await buttons.find((btn) => btn.text() === "Historique").trigger("click");
    await wrapper.vm.$nextTick();
    await buttons.find((btn) => btn.text() === "Logs").trigger("click");
    await wrapper.vm.$nextTick();

    state.running = false;
    state.taskStatus = "error";
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("error");
  });
});
