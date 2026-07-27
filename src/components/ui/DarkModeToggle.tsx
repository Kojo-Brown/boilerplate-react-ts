import { cn } from "@/lib/cn";
import { useTheme, type ThemeMode } from "@/context/ThemeContext";

// Non-empty tuple so the cycle always has a well-defined fallback entry.
const CYCLE = ["system", "light", "dark"] as const satisfies readonly ThemeMode[];

function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SystemIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

const LABELS: Record<ThemeMode, string> = {
  system: "System theme",
  light: "Light theme",
  dark: "Dark theme",
};

const NEXT_LABEL: Record<ThemeMode, string> = {
  system: "Switch to light theme",
  light: "Switch to dark theme",
  dark: "Switch to system theme",
};

interface DarkModeToggleProps {
  className?: string;
}

export function DarkModeToggle({ className }: DarkModeToggleProps) {
  const { mode, setMode } = useTheme();

  function handleClick() {
    const idx = CYCLE.indexOf(mode);
    const next = CYCLE[(idx + 1) % CYCLE.length] ?? CYCLE[0];
    setMode(next);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={NEXT_LABEL[mode]}
      title={LABELS[mode]}
      className={cn(
        "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[var(--radius-md)]",
        "text-[var(--color-fg-subtle)] transition-colors",
        "hover:bg-[var(--color-muted)] hover:text-[var(--color-fg)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
        className,
      )}
    >
      {mode === "light" && <SunIcon className="h-5 w-5" />}
      {mode === "dark" && <MoonIcon className="h-5 w-5" />}
      {mode === "system" && <SystemIcon className="h-5 w-5" />}
      <span className="sr-only">{LABELS[mode]}</span>
    </button>
  );
}
