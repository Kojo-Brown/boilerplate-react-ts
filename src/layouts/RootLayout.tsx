import { Outlet, ScrollRestoration } from "react-router";
import { Navbar } from "@/components/layout/Navbar";
import { Sidebar } from "@/components/layout/Sidebar";

export function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <ScrollRestoration />
      <Navbar />
      <div className="flex flex-1">
        <Sidebar />
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
