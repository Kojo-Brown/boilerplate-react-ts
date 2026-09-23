import { PrefetchNavLink } from "@/widgets/layout/PrefetchNavLink";
import { cn } from "@/shared/lib/cn";
import { useUi } from "@/shared/store/zustand";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { MD_AND_UP } from "@/shared/config/breakpoints";
import { ROUTES } from "@/shared/routes/paths";

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
  /*
   * The same breakpoint the `md:` classes below use, read in JavaScript
   * because two of the three things it decides are not styling.
   *
   * Above it the sidebar is a column of the page: always visible, always
   * reachable, no trap. Below it the same element is an overlay with a
   * backdrop over the content — a modal dialog in everything but the tag name,
   * and `showModal()` is not available to it because the element has to stay
   * put on a desktop. So the drawer's modal behaviour is assembled by hand
   * here, and only while the viewport says it is a drawer.
   */
  const isDesktop = useMediaQuery(MD_AND_UP);
  const isDrawer = !isDesktop;
  const isModal = isDrawer && sidebarOpen;
  /*
   * `closeSidebar` is a zustand action and therefore stable, so this does not
   * rebuild the trap on every render of the shell.
   */
  const drawerRef = useFocusTrap<HTMLElement>({ active: isModal, onEscape: closeSidebar });

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
        ref={drawerRef}
        /*
          Focusable but not tabbable, so the trap has somewhere to put focus
          when the drawer holds no enabled control.
        */
        tabIndex={-1}
        /*
          A closed drawer is off screen under `-translate-x-full`, and a
          transform removes nothing from the tab order: without `inert` the
          links below stay tabbable while invisible, so a phone user Tabbing
          through the header falls into three nav links that are not on the
          screen and cannot be scrolled to. `inert` is the attribute that says
          "this subtree is not here", and it is scoped to the drawer case —
          on a desktop the same markup is a visible landmark.
        */
        inert={isDrawer && !sidebarOpen}
        /*
          A landmark on a desktop, a modal dialog on a phone. The roles are
          swapped rather than both being present because they are claims about
          different things: `complementary` says "supporting content beside the
          page", which stops being true the moment the thing is covering the
          page and taking every keystroke.
        */
        {...(isModal
          ? ({ role: "dialog", "aria-modal": true, "aria-label": "Navigation" } as const)
          : {})}
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
            <PrefetchNavLink
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
            </PrefetchNavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
