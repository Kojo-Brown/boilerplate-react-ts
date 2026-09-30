import { useIntl } from "react-intl";
import { TransitionLink } from "@/features/route-transition/TransitionLink";
import { PrefetchNavLink } from "@/widgets/layout/PrefetchNavLink";
import { cn } from "@/shared/lib/cn";
import { useUi } from "@/shared/store/zustand";
import { APP_NAME } from "@/shared/config/app";
import { ROUTES } from "@/shared/routes/paths";
import { LocaleSwitcher } from "@/shared/i18n/LocaleSwitcher";
import type { MessageId } from "@/shared/i18n/messages";

interface NavItem {
  /**
   * The message id for the link text, not the text.
   *
   * The same reasoning as the route handles: these three links are the most
   * visible strings in the application, and a literal here would leave them in
   * English in every other language. They are separate ids from the route
   * titles even though both currently read "Home" — a nav label is short by
   * necessity and a page title is not, and the first language that needs them to
   * differ should be able to say so without editing the route config.
   */
  labelId: MessageId;
  to: string;
}

const NAV_ITEMS: NavItem[] = [
  { labelId: "nav.home", to: ROUTES.HOME },
  { labelId: "nav.dashboard", to: ROUTES.DASHBOARD },
  { labelId: "nav.about", to: ROUTES.ABOUT },
];

export function Navbar() {
  const { toggleSidebar } = useUi();
  const intl = useIntl();

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-[var(--color-bg)] px-4">
      <button
        type="button"
        aria-label={intl.formatMessage({ id: "nav.toggleSidebar" })}
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
        <span>{APP_NAME}</span>
      </TransitionLink>

      {/*
        `ms-4`, not `ml-4`. The gap belongs between the brand and the nav, and in
        a right-to-left document that is the other side — a physical `margin-left`
        would put it after the nav instead, collapsing the two together. The same
        substitution is made everywhere in `src/`, and
        `tooling/eslint/logicalProperties.ts` is what keeps it made.
      */}
      <nav
        className="ms-4 hidden items-center gap-1 md:flex"
        aria-label={intl.formatMessage({ id: "nav.main" })}
      >
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
            {intl.formatMessage({ id: item.labelId })}
          </PrefetchNavLink>
        ))}
      </nav>

      {/*
        `ms-auto` pushes the switcher to the end of the bar — the trailing edge
        in either direction, which is where it stays when the document mirrors.
      */}
      <LocaleSwitcher className="ms-auto" />
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
