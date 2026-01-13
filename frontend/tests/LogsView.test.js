import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import LogsView from "../src/components/LogsView.vue";
import { state } from "../src/state.js";

describe("LogsView", () => {
  it("shows empty state", () => {
    state.logs = [];
    const wrapper = mount(LogsView);
    expect(wrapper.text()).toContain("Aucun log");
  });

  it("shows logs", () => {
    state.logs = [{ time: "now", level: "error", message: "boom" }];
    const wrapper = mount(LogsView);
    expect(wrapper.text()).toContain("boom");
  });
});