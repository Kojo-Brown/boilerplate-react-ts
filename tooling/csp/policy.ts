/**
 * The Content-Security-Policy, as data.
 *
 * One module computes the policy and every consumer formats the same object:
 * the Vite dev server, `vite preview`, the nginx snippet the build emits for
 * the container, and the tests that assert all three agree. The alternative —
 * a string in `nginx.conf` and a second string in a dev middleware — is the
 * failure this file exists to prevent, and it is a failure with a particularly
 * nasty shape: the policy that breaks the application is the one nobody ran,
 * so the divergence is discovered in production by a blank page.
 *
 * ### Why the nonce is a parameter rather than something this module mints
 *
 * A nonce has to be unpredictable *per response*, which means only the thing
 * answering the request can supply it. Three callers do, and they supply three
 * different kinds of value: a dev request and a preview request each get a
 * fresh {@link createNonce}, while the nginx snippet gets the literal string
 * `$csp_nonce` — an nginx variable that nginx expands per request. Taking the
 * nonce as a string is what lets the same serializer produce a header for a
 * browser and a configuration line for a web server.
 *
 * ### Why `connect-src` is a parameter too
 *
 * `VITE_API_URL`, `VITE_ANALYTICS_URL` and `VITE_ERROR_REPORT_URL` are
 * build-time constants: Vite inlines them into the bundle. A policy that does
 * not read the same values the bundle was compiled against is wrong by
 * construction, and wrong in the one direction that cannot be caught by
 * reading it — `connect-src 'self'` beside a bundle compiled for
 * `https://api.example.com` is a build whose every request fails, in
 * production only, with the reason visible only in the browser console. So the
 * build computes the policy from its own resolved environment and emits it;
 * see `tooling/csp/vitePlugin.ts`.
 */

import { ENV_DEFAULTS } from "../../src/shared/config/envDefaults.ts";

/**
 * The token the build leaves in `index.html` wherever a nonce belongs.
 *
 * Vite writes it into every `<script>`, `<style>` and `<link rel="stylesheet">`
 * it generates (and into the `<meta property="csp-nonce">` its runtime reads)
 * when `html.cspNonce` is set. The server replaces it with a fresh value on
 * every response. A build artefact therefore contains a *placeholder* and
 * never a nonce — which is the only correct thing for a file that is written
 * once and served a million times.
 *
 * Deliberately not a plausible nonce. If the substitution is ever skipped the
 * page must fail loudly — nothing executes, the E2E spec goes red — rather
 * than ship a constant `nonce="AAAA…"` that every visitor shares, which is
 * strictly worse than having no nonce at all: it looks like a defence and an
 * attacker can read it out of the document.
 */
export const NONCE_PLACEHOLDER = "__CSP_NONCE__";

/**
 * 16 bytes, base64 — 128 bits, which is the floor CSP Level 3 names for a
 * nonce. 24 characters after encoding, all of them legal in the
 * `base64-value` grammar an `'nonce-…'` source expression is parsed with.
 */
export const NONCE_BYTE_LENGTH = 16;

/** Mints one nonce. `randomBytes` is injected so a test can be deterministic. */
export function createNonce(randomBytes: (size: number) => Uint8Array): string {
  return Buffer.from(randomBytes(NONCE_BYTE_LENGTH)).toString("base64");
}

export interface PolicyOptions {
  /**
   * What goes inside `'nonce-…'`. A real nonce for a real response; the literal
   * `$csp_nonce` when serializing for nginx.
   */
  readonly nonce: string;
  /**
   * Origins the application fetches from, beyond its own. Origins only — see
   * {@link connectSourcesFromEnv}.
   */
  readonly connectSrc?: readonly string[];
  /**
   * Adds the relaxations a Vite dev server cannot run without, and drops
   * `upgrade-insecure-requests`. Every one of them is named in
   * {@link DEVELOPMENT_RELAXATIONS} and asserted absent from the production
   * policy, so "it works in dev" can never be the reason the production policy
   * is loose.
   */
  readonly development?: boolean;
}

/**
 * The directives, in the order they are serialized.
 *
 * Ordering is cosmetic to a browser and load-bearing for a human: the
 * fetch-less directives first, because `default-src 'none'` is the sentence the
 * rest of the policy qualifies.
 */
export const DIRECTIVE_ORDER = [
  "default-src",
  "base-uri",
  "object-src",
  "frame-ancestors",
  "frame-src",
  "form-action",
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "media-src",
  "connect-src",
  "worker-src",
  "manifest-src",
  "upgrade-insecure-requests",
] as const;

export type Directive = (typeof DIRECTIVE_ORDER)[number];

/**
 * Source expressions that appear only in development, each with the reason.
 *
 * Asserted against in `policy.test.ts`: the production policy contains none of
 * them. A relaxation that leaks from a dev config into the shipped one is the
 * normal way a strict CSP stops being strict, and it leaks silently because the
 * dev server is where anybody would notice a policy being too tight.
 */
export const DEVELOPMENT_RELAXATIONS: Readonly<Record<string, string>> = {
  // Vite's HMR channel is a WebSocket to the dev server's own host, and `'self'`
  // does not cover a `ws:` scheme even on the same authority.
  "ws:": "Vite's HMR WebSocket",
  // `@tanstack/react-query-devtools` injects its stylesheet as a `<style>`
  // element it creates itself, with no nonce it could know about. It renders
  // nothing in a production build, so this buys development a panel and costs
  // production nothing.
  "'unsafe-inline'": "React Query Devtools' injected <style> element",
};

/**
 * Builds the policy.
 *
 * `default-src 'none'` and then every directive the application needs, spelled
 * out. The alternative — `default-src 'self'` and a handful of overrides — is
 * shorter and says nothing: a directive nobody thought about inherits
 * permission instead of inheriting a refusal, so the next feature that reaches
 * for a new fetch destination is allowed by default and the policy quietly
 * stops describing the application.
 */
export function buildPolicy(options: PolicyOptions): ReadonlyMap<Directive, readonly string[]> {
  const { nonce, connectSrc = [], development = false } = options;
  const nonceSource = `'nonce-${nonce}'`;

  const policy = new Map<Directive, readonly string[]>();

  policy.set("default-src", ["'none'"]);
  // `<base href>` rewrites every relative URL on the page, including the ones
  // in markup that was already there. Banning it is what stops an injected
  // `<base>` from redirecting this application's own `/assets/*` requests at an
  // attacker's host, and nothing here needs one.
  policy.set("base-uri", ["'none'"]);
  policy.set("object-src", ["'none'"]);
  // Not `'self'`: this application is never framed, by itself or by anyone.
  policy.set("frame-ancestors", ["'none'"]);
  policy.set("frame-src", ["'none'"]);
  // Covers `<form action>` and a form's JS-triggered submit. The OAuth hand-off
  // is a `location.assign()` to Google, which is a top-level navigation and not
  // a form submission — `navigate-to` was dropped from CSP3 and no browser
  // ships it, so nothing here needs to list `accounts.google.com`.
  policy.set("form-action", ["'self'"]);

  /*
    `'strict-dynamic'` is the directive that makes the nonce worth having.

    Without it a nonce only guards the tags that are in the HTML, and
    `script-src 'self'` still admits anything same-origin: an injection that
    writes `<script src="/some/uploaded/path.js">` is allowed. With it, the
    host allow-list — `'self'` included — is ignored for scripts, and the only
    scripts that run are the ones carrying this response's nonce plus whatever
    *those* scripts insert programmatically. That second half is what a bundler
    needs: every lazy route in this application arrives through an `import()`
    from a module that was itself nonced, and the preload `<link>`s Vite's
    runtime injects copy the nonce out of `<meta property="csp-nonce">`.

    `'self'` is kept beside it anyway. A browser that understands
    `'strict-dynamic'` ignores it; one that does not ignores `'strict-dynamic'`
    and falls back to same-origin scripts only, which is the best available
    answer there rather than a policy that blocks the whole application.
  */
  policy.set("script-src", ["'self'", nonceSource, "'strict-dynamic'"]);

  /*
    No `'strict-dynamic'` on `style-src`: it is not defined for styles, and
    `'self'` is doing real work here — Tailwind compiles to one hashed
    stylesheet that the browser loads as a `<link>`.

    Inline `style` *attributes* are not an omission. React sets the `style`
    prop through the CSSOM (`element.style.setProperty`), which CSP does not
    govern at all; `style-src-attr` would only matter for style attributes that
    arrive as markup, and `security/no-dangerous-html` already means no markup
    arrives as a string. See `docs/xss.md`.
  */
  policy.set("style-src", development ? ["'self'", "'unsafe-inline'"] : ["'self'", nonceSource]);

  // `data:` because Vite inlines any asset under `assetsInlineLimit` as a data
  // URI and Tailwind ships a few utilities whose background is one. Not
  // `blob:`: nothing here renders an object URL, and `blob:` in `img-src` is a
  // documented way to turn an XSS into an exfiltration channel.
  policy.set("img-src", ["'self'", "data:"]);
  // No webfont: the type stack is system fonts. `'self'` rather than `'none'`
  // so adding one is a change to a stylesheet and not to the policy.
  policy.set("font-src", ["'self'"]);
  policy.set("media-src", ["'none'"]);

  policy.set("connect-src", ["'self'", ...dedupe(connectSrc), ...(development ? ["ws:"] : [])]);

  // `/sw.js` and `csvParser.worker.ts`, both same-origin. `worker-src` falls
  // back to `script-src` when absent, and `script-src` here carries
  // `'strict-dynamic'`, which is meaningless for a worker and would make the
  // registration depend on browser-specific fallback behaviour. Spelling it
  // out removes the question.
  policy.set("worker-src", ["'self'"]);
  policy.set("manifest-src", ["'self'"]);

  // Omitted in development, where the dev server is plain `http://localhost`
  // and the mock API is a second plain-HTTP origin. In production it is free
  // insurance against a relative URL that somehow resolves to `http:`.
  if (!development) policy.set("upgrade-insecure-requests", []);

  return policy;
}

/** `default-src 'none'; base-uri 'none'; …` — one header value, no newlines. */
export function serializePolicy(policy: ReadonlyMap<Directive, readonly string[]>): string {
  return DIRECTIVE_ORDER.filter((directive) => policy.has(directive))
    .map((directive) => [directive, ...(policy.get(directive) ?? [])].join(" "))
    .join("; ");
}

/** {@link buildPolicy} then {@link serializePolicy}, which is every real use. */
export function cspHeaderValue(options: PolicyOptions): string {
  return serializePolicy(buildPolicy(options));
}

/**
 * The environment variables whose values the application turns into requests.
 *
 * Not every `VITE_*` URL belongs here, and the two that are missing say what
 * the list means. `VITE_REDIRECT_URI` is a URL the OAuth provider navigates
 * *to*, so no directive governs it. `VITE_AUTH_DOMAIN` is read by nothing —
 * `oauth.ts` has Google's endpoint as a constant and reaches it by navigation.
 */
export const CONNECT_SRC_ENV_KEYS = [
  "VITE_API_URL",
  "VITE_ANALYTICS_URL",
  "VITE_ERROR_REPORT_URL",
] as const;

/**
 * The origins {@link CONNECT_SRC_ENV_KEYS} name, as CSP source expressions.
 *
 * **Origins, never the full URL**, and that is a decision rather than
 * tidiness. A CSP source expression with a path matches by path *prefix* and
 * only after a trailing-slash rule most people get wrong, so
 * `connect-src https://api.example.com/v1` admits `/v1-staging` and refuses
 * `/v1` written as `/v1/`. A policy that is subtly wider and subtly narrower
 * than it reads is worse than one that is honestly origin-scoped, and the
 * narrowing it was reaching for belongs to the API's own authorization.
 *
 * Unparseable or empty values are dropped rather than thrown on: `env.ts`
 * validates these with Zod at boot and is the right place for that error. A
 * build that fails here would fail with a worse message.
 */
export function connectSourcesFromEnv(env: Readonly<Record<string, string | undefined>>): string[] {
  /*
    `ENV_DEFAULTS` underneath, and this is the correction to a real bug rather
    than defensiveness.

    An unset variable is absent from Vite's resolved `env` and present in the
    bundle, because `env.ts`'s schema fills it in with a Zod `.default()`. So a
    build with no `VITE_API_URL` produced `connect-src 'self'` beside an
    application fetching `http://localhost:4000`, and every request it made was
    refused — found by loading a production build under the policy, which is
    the only place it is visible. The defaults are therefore read from the same
    module the schema reads them from. See `src/shared/config/envDefaults.ts`.
  */
  const resolved: Record<string, string | undefined> = { ...ENV_DEFAULTS, ...env };
  const origins = new Set<string>();
  for (const key of CONNECT_SRC_ENV_KEYS) {
    const value = resolved[key];
    if (value === undefined || value === "") continue;
    let origin: string;
    try {
      origin = new URL(value).origin;
    } catch {
      continue;
    }
    // `new URL("data:…").origin` is the string "null", which as a source
    // expression means "nothing" and as a line in a policy means "somebody
    // misconfigured this".
    if (origin === "null") continue;
    origins.add(origin);
  }
  return [...origins].sort((a, b) => a.localeCompare(b));
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}
