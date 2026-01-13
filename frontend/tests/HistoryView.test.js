import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import HistoryView from "../src/components/HistoryView.vue";

const apiMocks = vi.hoisted(() => ({
  fetchHistory: vi.fn(async () => ({
    items: [{
      id: 1,
      filename: "file.txt",
      status: "COPIED",
      first_seen_at: "now",
      source_path: "/sources/project-a/file.txt",
      destination_path: "/destinations/project-b/file.txt"
    }]
  }))
}));

vi.mock("../src/api.js", () => apiMocks);

describe("HistoryView", () => {
  it("renders history", async () => {
    const wrapper = mount(HistoryView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain("file.txt");
  });

  it("renders empty state", async () => {
    apiMocks.fetchHistory.mockResolvedValueOnce({ items: [] });
    const wrapper = mount(HistoryView);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wrapper.text()).toContain("Aucun fichier");
  });
});
