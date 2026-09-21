import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import type { Result } from "axe-core";

/**
 * The rule set the gate runs, and why it is spelled out rather than defaulted.
 *
 * `AxeBuilder` with no `withTags` runs everything axe ships, including its
 * `best-practice` rules — which are opinions, not the standard: `region`
 * wants every byte of the page inside a landmark, `page-has-heading-one` wants
 * an `<h1>` on a dialog. Shipping those in a zero-violation gate means the
 * first failure a contributor meets is one the WCAG document does not contain,
 * and the gate's authority goes with it.
 *
 * These five tags are AA and below across 2.0, 2.1 and 2.2. The 2.2 additions
 * axe can test automatically are the `target-size` family and
 * `focus-not-obscured`; the rest of that release is human-judgement criteria
 * (accessible authentication, redundant entry) that no scanner decides. That
 * boundary is the honest claim of this gate: it proves the machine-checkable
 * part of AA, and proves it on every route.
 */
export const WCAG_22_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

/** A page state the gate audits. */
export interface AuditTarget {
  /** How the failure reads. */
  readonly name: string;
  /**
   * The registered route this exercises, exactly as `ROUTES` spells it.
   *
   * Separate from `url` because the URL may carry a query string the route
   * does not, and because this is what {@link readRegisteredRoutes} is
   * compared against — in both directions, so a route the app registers and
   * this list omits fails, and so does a typo here that matches nothing the
   * app registers.
   */
  readonly route: string;
  /** What the browser navigates to. Defaults to {@link AuditTarget.route}. */
  readonly url?: string;
  /** True for routes behind `ProtectedRoute`. */
  readonly authenticated?: boolean;
  /** Something on the page that proves it finished rendering. */
  readonly ready: string;
}

/**
 * Every route in the application, in the state a first-time visitor sees.
 *
 * The list is exhaustive by construction rather than by diligence: the
 * coverage test in `a11y.spec.ts` compares it against the registry and fails
 * on anything missing, so adding a route to the app without adding it here is
 * a red build rather than a page that quietly goes unaudited.
 */
export const AUDIT_TARGETS: readonly AuditTarget[] = [
  { name: "home", route: "/", ready: "h1" },
  { name: "about", route: "/about", ready: "h1" },
  { name: "dashboard", route: "/dashboard", authenticated: true, ready: "h1" },
  { name: "login", route: "/login", ready: "form" },
  {
    name: "oauth callback",
    route: "/auth/callback",
    // No `code` parameter, so the page renders its failure state. That is the
    // state worth auditing: the success path is a redirect nobody reads, and
    // an error message is exactly the content a screen-reader user needs.
    ready: "body",
  },
  {
    name: "concurrency lab",
    route: "/labs/concurrency",
    /*
     * `?n=50` rather than the page's default 15,000 rows, and this is about
     * the gate's runtime, not its coverage. axe walks the accessibility tree
     * of everything rendered: at the default size this one route takes longer
     * to audit than the other twenty put together — minutes — and it finds the
     * same thing, because the rows are one component repeated. What
     * accessibility this page has is in its markup, and fifty rows contain all
     * of it.
     */
    url: "/labs/concurrency?n=50",
    ready: "[data-testid='filter-results']",
  },
  { name: "optimistic lab", route: "/labs/optimistic", ready: "h1" },
  { name: "query cache lab", route: "/labs/query-cache", ready: "h1" },
  { name: "use() lab", route: "/labs/use", ready: "h1" },
  { name: "actions lab", route: "/labs/actions", ready: "h1" },
  { name: "streaming lab", route: "/labs/streaming", ready: "h1" },
  { name: "navigation lab", route: "/labs/navigation", ready: "h1" },
  { name: "headless lab", route: "/labs/headless", ready: "h1" },
  { name: "polymorphic lab", route: "/labs/polymorphic", ready: "h1" },
  { name: "render props lab", route: "/labs/render-props", ready: "h1" },
  { name: "checkout lab", route: "/labs/checkout", ready: "h1" },
  {
    name: "dependency inversion lab",
    route: "/labs/dependency-inversion",
    ready: "h1",
  },
  { name: "worker lab", route: "/labs/workers", ready: "h1" },
  {
    name: "infinite scroll lab",
    route: "/labs/infinite-scroll",
    ready: "[data-testid='virtual-scroll-container']",
  },
  { name: "prefetch lab", route: "/labs/prefetch", ready: "h1" },
  { name: "image lab", route: "/labs/images", ready: "h1" },
  { name: "error lab", route: "/labs/errors", ready: "h1" },
];

/**
 * Pages that answer to a URL but are not entries in `ROUTES`.
 *
 * They are the two a route registry structurally cannot hold — a catch-all,
 * and a child path a lab links to — and they are also the two most likely to
 * be forgotten, which is the argument for listing them by hand rather than
 * leaving the sweep to what `ROUTES` happens to enumerate. A 404 is a page
 * users reach by accident and read carefully.
 */
export const UNREGISTERED_TARGETS: readonly (Omit<AuditTarget, "route"> & { url: string })[] = [
  { name: "not found", url: "/no-such-page", ready: "h1" },
  { name: "slow route lab", url: "/labs/navigation/slow", ready: "h1" },
];

/** Must mirror AUTH_STORAGE_KEYS in src/entities/session/authSlice.ts */
const AUTH_STORAGE_KEYS = {
  ACCESS_TOKEN: "auth.accessToken",
  REFRESH_TOKEN: "auth.refreshToken",
  EXPIRES_AT: "auth.expiresAt",
  USER: "auth.user",
} as const;

/** Obviously-fake session, seeded so `ProtectedRoute` lets the audit through. */
export async function seedSession(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ({ keys, expiresAt }) => {
      localStorage.setItem(keys.ACCESS_TOKEN, "mock-access-token");
      localStorage.setItem(keys.REFRESH_TOKEN, "mock-refresh-token");
      localStorage.setItem(keys.EXPIRES_AT, JSON.stringify(expiresAt));
      localStorage.setItem(
        keys.USER,
        JSON.stringify({ id: "1", email: "audit@example.test", role: "user" }),
      );
    },
    { keys: AUTH_STORAGE_KEYS, expiresAt: Date.now() + 15 * 60 * 1000 },
  );
}

/** Runs axe over whatever the page is currently showing. */
export async function analyze(page: Page): Promise<readonly Result[]> {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_22_AA_TAGS]).analyze();
  return results.violations;
}

/**
 * Turns axe's result object into something a pull request can be fixed from.
 *
 * Playwright prints a failed `expect` on an array of objects as a diff of
 * nested JSON, which for a `color-contrast` violation across nineteen nodes is
 * several screens of `any` and tells you neither the ratio nor the selector.
 * What a contributor needs is the rule, the element and the sentence axe
 * already wrote about why it failed.
 */
export function formatViolations(violations: readonly Result[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => {
          const summary = (node.failureSummary ?? "").split("\n").join("\n      ").trim();
          return [
            `    at ${node.target.join(" ")}`,
            `      ${node.html.slice(0, 160)}`,
            `      ${summary}`,
          ].join("\n");
        })
        .join("\n");
      return [
        `  ${violation.id} (${violation.impact ?? "unknown"} impact) — ${violation.help}`,
        `  ${violation.helpUrl}`,
        nodes,
      ].join("\n");
    })
    .join("\n\n");
}

/** Asserts the current page state has no WCAG 2.2 AA violation axe can see. */
export async function expectNoViolations(page: Page, what: string): Promise<void> {
  const violations = await analyze(page);
  expect(
    violations.map((violation) => violation.id),
    `${what} has accessibility violations:\n\n${formatViolations(violations)}\n`,
  ).toEqual([]);
}

/**
 * The route paths `src/shared/routes/paths.ts` declares, read as text.
 *
 * Importing `ROUTES` would be the obvious thing and is the one thing this file
 * may not do. `tsconfig.node.json` is a composite project that owns `e2e/` and
 * `tooling/`, `tsconfig.json` owns `src/` and references it; a file imported
 * across that line joins both programs, and `tsc --noEmit` then fails with
 * TS6305 on a clean checkout because the referenced project's declaration
 * output does not exist yet. Reading the source is what keeps the check
 * honest without moving a source file into two projects — and it is the same
 * move `tooling/a11y/tokenContrast.test.ts` makes on `globals.css`, for the
 * same reason: the file on disk is the fact, and parsing it cannot drift from
 * it the way a copied list can.
 *
 * The parse is deliberately brittle. `ROUTES` is a flat object of string
 * literals, and if it ever stops being one this throws rather than quietly
 * returning fewer routes than the app has — which would turn the coverage
 * check green by finding nothing to check.
 */
export function readRegisteredRoutes(): readonly string[] {
  const source = readFileSync(new URL("../src/shared/routes/paths.ts", import.meta.url), "utf8");
  const body = /export const ROUTES = \{([\s\S]*?)\n\} as const;/.exec(source)?.[1];
  if (body === undefined) {
    throw new Error("Could not find the `ROUTES` object in src/shared/routes/paths.ts");
  }

  const routes = [...body.matchAll(/^\s+[A-Z][A-Z0-9_]*:\s*"([^"]+)",$/gm)].map(
    (match) => match[1] as string,
  );
  const entries = body.split("\n").filter((line) => line.trim().length > 0).length;
  if (routes.length !== entries) {
    throw new Error(
      `Parsed ${String(routes.length)} of ${String(entries)} lines in \`ROUTES\`; ` +
        "it is no longer a flat map of string literals and this parser needs updating",
    );
  }
  return routes;
}
