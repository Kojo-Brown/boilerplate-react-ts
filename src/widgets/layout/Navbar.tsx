import { TransitionLink } from "@/features/route-transition/TransitionLink";
import { PrefetchNavLink } from "@/widgets/layout/PrefetchNavLink";
import { cn } from "@/shared/lib/cn";
import { useUi } from "@/shared/store/zustand";
import { ROUTES } from "@/shared/routes/paths";

interface NavItem {
  label: string;
  to: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Home", to: ROUTES.HOME },
  { label: "Dashboard", to: ROUTES.DASHBOARD },
  { label: "About", to: ROUTES.ABOUT },
];

export function Navbar() {
  const { toggleSidebar } = useUi();

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-[var(--color-bg)] px-4">
      <button
        type="button"
        aria-label="Toggle sidebar"
        onClick={toggleSidebar}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)]",
          "text-[var(--color-muted-fg)] transition-colors",
          "hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]",
          "md:hidden",
        )}
      >
        <MenuIcon />
      </button>

      <TransitionLink
        to={ROUTES.HOME}
        className="flex items-center gap-2 font-semibold text-[var(--color-fg)]"
      >
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded text-xs font-bold",
            "bg-[var(--color-primary)] text-[var(--color-primary-fg)]",
          )}
        >
          R
        </span>
        <span>React TS</span>
      </TransitionLink>

      <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <PrefetchNavLink
            key={item.to}
            to={item.to}
            end={item.to === ROUTES.HOME}
            className={({ isActive, isPendingTarget }) =>
              cn(
                "rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                  : "text-[var(--color-muted-fg)] hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]",
                // The destination being waited on. Without this the only
                // feedback is the page-level bar, which does not say *which*
                // item was clicked — and the held page still shows the old
                // item as the active one.
                isPendingTarget && "opacity-60",
              )
            }
          >
            {item.label}
          </PrefetchNavLink>
        ))}
      </nav>
    </header>
  );
}

function MenuIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
