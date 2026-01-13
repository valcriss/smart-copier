import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import DashboardView from "../src/components/DashboardView.vue";
import { state } from "../src/state.js";

vi.mock("../src/api.js", () => ({
  updateConfig: vi.fn(async (payload) => ({ config: payload }))
}));

function resetState() {
  state.associations = [];
  state.config = {
    associations: [],
    ignoredExtensions: [],
    scanIntervalSeconds: 60,
    dryRun: false
  };
  state.allowedRoots = {
    source: ["/sources/project-a"],
    destination: ["/destinations/project-b"]
  };
}

describe("DashboardView", () => {
  it("shows empty message", () => {
    resetState();
    const wrapper = mount(DashboardView);
    expect(wrapper.text()).toContain("aucune copie en cours");
  });

  it("renders associations and actions", async () => {
    resetState();
    state.associations = [
      {
        id: "a",
        input: "/sources/project-a",
        output: "/destinations/project-b",
        status: "copying",
        pendingCount: 0,
        toCopyCount: 0,
        currentFile: {
          filename: "file.txt",
          percent: 50,
          copiedBytes: 5,
          size: 10,
          speedBytesPerSecond: 1,
          etaSeconds: 5
        }
      }
    ];
    state.config.associations = [
      { id: "a", input: "/sources/project-a", output: "/destinations/project-b" }
    ];
    const wrapper = mount(DashboardView);
    expect(wrapper.find("button").text()).toContain("Ajouter");
    expect(wrapper.text()).toContain("Modifier");
    expect(wrapper.text()).toContain("Supprimer");
    expect(wrapper.text()).toContain("file.txt");

    await wrapper.find("button").trigger("click");
    await wrapper.vm.$nextTick();
    const saveButton = wrapper.findAll("button").find((btn) => btn.text() === "Enregistrer");
    await saveButton.trigger("click");

    const modal = wrapper.findComponent({ name: "AssociationModal" });
    await modal.vm.$emit("close");
    await wrapper.vm.$nextTick();

    state.associations = [
      {
        id: "b",
        input: "/sources/project-a",
        output: "/destinations/project-b",
        status: "error",
        pendingCount: 0,
        toCopyCount: 0,
        currentFile: null
      },
      {
        id: "c",
        input: "/sources/project-a",
        output: "/destinations/project-b",
        status: "idle",
        pendingCount: 0,
        toCopyCount: 0,
        currentFile: null
      }
    ];
    await wrapper.vm.$nextTick();
    const editButton = wrapper.findAll("button").find((btn) => btn.text() === "Modifier");
    await editButton.trigger("click");
    const deleteButton = wrapper.findAll("button").find((btn) => btn.text() === "Supprimer");
    await deleteButton.trigger("click");
  });

  it("shows pending and to-copy badges", () => {
    resetState();
    state.associations = [
      {
        id: "p",
        input: "/sources/project-a",
        output: "/destinations/project-b",
        status: "idle",
        pendingCount: 2,
        toCopyCount: 4,
        currentFile: null
      }
    ];
    const wrapper = mount(DashboardView);
    expect(wrapper.text()).toContain("2 fichiers en attente");
    expect(wrapper.text()).toContain("4 fichiers a copier");
  });

  it("defaults missing counts to zero", () => {
    resetState();
    state.associations = [
      {
        id: "z",
        input: "/sources/project-a",
        output: "/destinations/project-b",
        status: "idle",
        currentFile: null
      }
    ];
    const wrapper = mount(DashboardView);
    expect(wrapper.text()).toContain("0 fichiers en attente");
    expect(wrapper.text()).toContain("0 fichiers a copier");
  });
});
