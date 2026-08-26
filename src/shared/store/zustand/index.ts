import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { createUiSlice, type UiSlice } from "@/shared/store/zustand/uiSlice";
import {
  createNotificationsSlice,
  type NotificationsSlice,
} from "@/shared/store/zustand/notificationsSlice";

export type { UiSlice } from "@/shared/store/zustand/uiSlice";
export type {
  NotificationsSlice,
  Notification,
  NotificationType,
} from "@/shared/store/zustand/notificationsSlice";

export type BoundState = UiSlice & NotificationsSlice;

export const useBoundStore = create<BoundState>()(
  devtools(
    (...a) => ({
      ...createUiSlice(...a),
      ...createNotificationsSlice(...a),
    }),
    { name: "app-store" },
  ),
);

export const useUi = () =>
  useBoundStore(
    useShallow((s) => ({
      sidebarOpen: s.sidebarOpen,
      activeModal: s.activeModal,
      openSidebar: s.openSidebar,
      closeSidebar: s.closeSidebar,
      toggleSidebar: s.toggleSidebar,
      openModal: s.openModal,
      closeModal: s.closeModal,
    })),
  );

export const useNotifications = () =>
  useBoundStore(
    useShallow((s) => ({
      notifications: s.notifications,
      addNotification: s.addNotification,
      removeNotification: s.removeNotification,
      clearNotifications: s.clearNotifications,
    })),
  );
