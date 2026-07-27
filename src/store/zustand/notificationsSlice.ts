import type { StateCreator } from "zustand";

export type NotificationType = "success" | "error" | "info" | "warning";

export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  duration: number;
}

export interface NotificationsSlice {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, "id">) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

export const createNotificationsSlice: StateCreator<
  NotificationsSlice,
  [],
  [],
  NotificationsSlice
> = (set) => ({
  notifications: [],
  addNotification: (notification) =>
    { set((state) => ({
      notifications: [
        ...state.notifications,
        { id: crypto.randomUUID(), ...notification },
      ],
    })); },
  removeNotification: (id) =>
    { set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })); },
  clearNotifications: () => { set({ notifications: [] }); },
});
