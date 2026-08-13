import { TransitionNavLink } from "@/components/navigation/TransitionNavLink";
import { cn } from "@/lib/cn";
import { useUi } from "@/store/zustand";
import { ROUTES } from "@/router/paths";

interface SidebarItem {
  label: string;
  to: string;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { label: "Home", to: ROUTES.HOME },
  { label: "Dashboard", to: ROUTES.DASHBOARD },
  { label: "About", to: ROUTES.ABOUT },
];

export function Sidebar() {
  const { sidebarOpen, closeSidebar } = useUi();

  return (
    <>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          // Base: fixed overlay on mobile
          "fixed inset-y-0 left-0 z-30 flex w-64 flex-col overflow-y-auto",
          "border-r bg-[var(--color-bg)] pt-14 pb-6",
          "transition-transform duration-200 ease-in-out",
          // Desktop: normal flow (overrides fixed positioning)
          "md:static md:inset-auto md:z-auto md:w-64 md:translate-x-0 md:pt-6",
          // Mobile: slide in/out based on Zustand state
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* The label belongs on the <nav> landmark, not the <aside>: it is the
            navigation region that assistive tech announces and queries by name. */}
        <nav className="flex flex-col gap-1 px-3" aria-label="Sidebar navigation">
          {SIDEBAR_ITEMS.map((item) => (
            <TransitionNavLink
              key={item.to}
              to={item.to}
              end={item.to === ROUTES.HOME}
              onClick={closeSidebar}
              className={({ isActive, isPendingTarget }) =>
                cn(
                  "rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                    : "text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]",
                  isPendingTarget && "opacity-60",
                )
              }
            >
              {item.label}
            </TransitionNavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
