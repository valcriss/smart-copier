import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import AssociationModal from "../src/components/AssociationModal.vue";

describe("AssociationModal", () => {
  it("emits save with defaults", async () => {
    const wrapper = mount(AssociationModal, {
      props: {
        open: true,
        allowedRoots: { source: ["/sources/project-a"], destination: ["/destinations/project-b"] }
      }
    });

    const saveButton = wrapper.findAll("button").find((btn) => btn.text() === "Enregistrer");
    await saveButton.trigger("click");

    const events = wrapper.emitted("save");
    expect(events).toBeTruthy();
    expect(events[0][0].input).toBe("/sources/project-a");
    expect(events[0][0].id.startsWith("assoc-")).toBe(true);
  });

  it("uses existing association", async () => {
    const wrapper = mount(AssociationModal, {
      props: {
        open: true,
        mode: "edit",
        association: { id: "a", input: "/sources/project-a", output: "/destinations/project-b" },
        allowedRoots: { source: ["/sources/project-a"], destination: ["/destinations/project-b"] }
      }
    });

    const selects = wrapper.findAll("select");
    expect(selects[0].element.value).toBe("/sources/project-a");
  });

  it("preserves id in edit mode", async () => {
    const wrapper = mount(AssociationModal, {
      props: {
        open: true,
        mode: "edit",
        association: { id: "assoc-1", input: "/sources/project-a", output: "/destinations/project-b" },
        allowedRoots: { source: ["/sources/project-a"], destination: ["/destinations/project-b"] }
      }
    });

    const saveButton = wrapper.findAll("button").find((btn) => btn.text() === "Enregistrer");
    await saveButton.trigger("click");

    const events = wrapper.emitted("save");
    expect(events[0][0].id).toBe("assoc-1");
  });

  it("emits close", async () => {
    const wrapper = mount(AssociationModal, {
      props: {
        open: true,
        allowedRoots: { source: ["/sources/project-a"], destination: ["/destinations/project-b"] }
      }
    });

    const closeButton = wrapper.findAll("button").find((btn) => btn.text() === "Close");
    await closeButton.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("closes via cancel button", async () => {
    const wrapper = mount(AssociationModal, {
      props: {
        open: true,
        allowedRoots: { source: ["/sources/project-a"], destination: ["/destinations/project-b"] }
      }
    });

    const cancelButton = wrapper.findAll("button").find((btn) => btn.text() === "Annuler");
    await cancelButton.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("updates defaults when opened", async () => {
    const wrapper = mount(AssociationModal, {
      props: {
        open: false,
        allowedRoots: {
          source: ["/sources/project-a", "/sources/project-b"],
          destination: ["/destinations/project-b", "/destinations/project-c"]
        }
      }
    });

    await wrapper.setProps({ open: true });
    const selects = wrapper.findAll("select");
    expect(selects[0].element.value).toBe("/sources/project-a");
    expect(selects[1].element.value).toBe("/destinations/project-b");

    await selects[0].setValue("/sources/project-b");
    await selects[1].setValue("/destinations/project-c");
  });

  it("uses fallback allowed roots", () => {
    const wrapper = mount(AssociationModal, {
      props: {
        open: true
      }
    });

    expect(wrapper.findAll("option").length).toBe(0);
  });
});
