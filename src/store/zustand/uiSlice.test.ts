import { beforeEach, describe, expect, it } from "vitest";
import { useBoundStore } from "./index";

beforeEach(() => {
  useBoundStore.setState({ sidebarOpen: false, activeModal: null });
});

describe("uiSlice — sidebar", () => {
  it("has closed sidebar by default", () => {
    expect(useBoundStore.getState().sidebarOpen).toBe(false);
  });

  it("openSidebar sets sidebarOpen to true", () => {
    useBoundStore.getState().openSidebar();
    expect(useBoundStore.getState().sidebarOpen).toBe(true);
  });

  it("closeSidebar sets sidebarOpen to false", () => {
    useBoundStore.getState().openSidebar();
    useBoundStore.getState().closeSidebar();
    expect(useBoundStore.getState().sidebarOpen).toBe(false);
  });

  it("toggleSidebar flips the value each call", () => {
    useBoundStore.getState().toggleSidebar();
    expect(useBoundStore.getState().sidebarOpen).toBe(true);
    useBoundStore.getState().toggleSidebar();
    expect(useBoundStore.getState().sidebarOpen).toBe(false);
  });
});

describe("uiSlice — modal", () => {
  it("has no active modal by default", () => {
    expect(useBoundStore.getState().activeModal).toBeNull();
  });

  it("openModal sets the modal id", () => {
    useBoundStore.getState().openModal("confirm-dialog");
    expect(useBoundStore.getState().activeModal).toBe("confirm-dialog");
  });

  it("openModal replaces an already-open modal", () => {
    useBoundStore.getState().openModal("first");
    useBoundStore.getState().openModal("second");
    expect(useBoundStore.getState().activeModal).toBe("second");
  });

  it("closeModal clears the modal id", () => {
    useBoundStore.getState().openModal("confirm-dialog");
    useBoundStore.getState().closeModal();
    expect(useBoundStore.getState().activeModal).toBeNull();
  });
});
