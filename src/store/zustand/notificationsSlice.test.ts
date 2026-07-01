import { beforeEach, describe, expect, it } from "vitest";
import { useBoundStore } from "./index";

beforeEach(() => {
  useBoundStore.setState({ notifications: [] });
});

describe("notificationsSlice", () => {
  it("starts with no notifications", () => {
    expect(useBoundStore.getState().notifications).toHaveLength(0);
  });

  it("addNotification appends a notification with a generated id", () => {
    useBoundStore.getState().addNotification({
      message: "Saved successfully",
      type: "success",
      duration: 3000,
    });
    const { notifications } = useBoundStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message).toBe("Saved successfully");
    expect(notifications[0]?.type).toBe("success");
    expect(typeof notifications[0]?.id).toBe("string");
    expect(notifications[0]?.id.length).toBeGreaterThan(0);
  });

  it("addNotification assigns unique ids", () => {
    useBoundStore.getState().addNotification({ message: "A", type: "info", duration: 2000 });
    useBoundStore.getState().addNotification({ message: "B", type: "warning", duration: 2000 });
    const { notifications } = useBoundStore.getState();
    expect(notifications).toHaveLength(2);
    expect(notifications[0]?.id).not.toBe(notifications[1]?.id);
  });

  it("removeNotification removes only the matched id", () => {
    useBoundStore.getState().addNotification({ message: "First", type: "info", duration: 2000 });
    useBoundStore.getState().addNotification({ message: "Second", type: "error", duration: 4000 });
    const idToRemove = useBoundStore.getState().notifications[0]?.id ?? "";
    useBoundStore.getState().removeNotification(idToRemove);
    const { notifications } = useBoundStore.getState();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message).toBe("Second");
  });

  it("removeNotification is a no-op for unknown id", () => {
    useBoundStore.getState().addNotification({ message: "Keep me", type: "success", duration: 3000 });
    useBoundStore.getState().removeNotification("non-existent-id");
    expect(useBoundStore.getState().notifications).toHaveLength(1);
  });

  it("clearNotifications empties the list", () => {
    useBoundStore.getState().addNotification({ message: "A", type: "info", duration: 2000 });
    useBoundStore.getState().addNotification({ message: "B", type: "error", duration: 4000 });
    useBoundStore.getState().clearNotifications();
    expect(useBoundStore.getState().notifications).toHaveLength(0);
  });
});
