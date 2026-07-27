import type { StateCreator } from "zustand";

export interface UiSlice {
  sidebarOpen: boolean;
  activeModal: string | null;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  openModal: (id: string) => void;
  closeModal: () => void;
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  sidebarOpen: false,
  activeModal: null,
  openSidebar: () => {
    set({ sidebarOpen: true });
  },
  closeSidebar: () => {
    set({ sidebarOpen: false });
  },
  toggleSidebar: () => {
    set((s) => ({ sidebarOpen: !s.sidebarOpen }));
  },
  openModal: (id) => {
    set({ activeModal: id });
  },
  closeModal: () => {
    set({ activeModal: null });
  },
});
