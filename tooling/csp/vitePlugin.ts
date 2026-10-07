import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { NONCE_PLACEHOLDER, connectSourcesFromEnv, createNonce, cspHeaderValue } from "./policy.ts";

/**
 * The Vite half of the Content-Security-Policy.
 *
 * A nonce cannot live in a build artefact — it has to be unguessable per
 * response, and `index.html` is written once. So the build's job is to leave a
 * marked hole and to prove the hole is in every place that needs one, and some
 * server's job is to fill it. This plugin is three things, and the third is the
 * one that makes the first two trustworthy:
 *
 * 1. **It turns the hole on.** `html.cspNonce` makes Vite write
 *    `nonce="__CSP_NONCE__"` onto every `<script>`, `<style>` and
 *    `<link rel="stylesheet">` it generates, plus the
 *    `<meta property="csp-nonce">` its own runtime reads when it injects a
 *    preload link for a lazy chunk.
 * 2. **It fills the hole in development and in `vite preview`,** per request,
 *    with the real header attached — so the policy is enforced by a browser on
 *    every E2E run rather than first enforced in production. This is the whole
 *    reason the plugin exists instead of a dozen lines in `nginx.conf`: a
 *    policy no test has ever run is a guess.
 * 3. **It fails the build** if the emitted HTML has a tag the policy would
 *    block, and emits the policy it computed as a file the server
 *    configuration includes, so the two cannot disagree. `connect-src` is
 *    derived from the same `VITE_*` values Vite inlines into the bundle; a
 *    hand-maintained `nginx.conf` would be a second source of truth for them,
 *    and the symptom of its being stale is every API call failing in
 *    production only. It also stops `vite preview` serving the dot-directories
 *    `dist/` carries, including the policy it just wrote there.
 *
 * `docs/csp.md` is the prose, including what the nginx side has to do and why
 * a static host cannot do it at all.
 */

/** Where the generated policy lands in `dist/`. */
export const POLICY_DIR = ".csp";
/** An nginx `set` directive defining `$csp_policy`. */
export const POLICY_CONF_FILE = `${POLICY_DIR}/policy.conf`;
/** The same value as a bare header string, for hosts that are not nginx. */
export const POLICY_TXT_FILE = `${POLICY_DIR}/policy.txt`;

/**
 * The nginx variable the generated snippet interpolates, and which
 * `nginx.conf` must have set before it includes the snippet.
 */
export const NGINX_NONCE_VARIABLE = "$csp_nonce";

export interface CspPluginOptions {
  /** Injected so a test can mint a predictable nonce. */
  readonly randomBytes?: (size: number) => Uint8Array;
}

export function csp(options: CspPluginOptions = {}): Plugin {
  const random = options.randomBytes ?? randomBytes;
  let connectSrc: readonly string[] = [];
  let root = process.cwd();
  let outDir = "dist";
  let devProxyPrefixes: readonly string[] = [];
  let previewProxyPrefixes: readonly string[] = [];

  return {
    name: "app:csp",
    // After everything: the HTML audit in `generateBundle` has to see what the
    // last plugin wrote, and `html.cspNonce` has to survive any plugin that
    // merges config.
    enforce: "post",

    config() {
      return { html: { cspNonce: NONCE_PLACEHOLDER } };
    },

    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
      devProxyPrefixes = Object.keys(config.server.proxy ?? {});
      previewProxyPrefixes = Object.keys(config.preview.proxy ?? {});
      /*
        `config.env` rather than `process.env`, and that is the point of reading
        it here: it is the resolved, prefix-filtered, `.env`-file-merged set of
        values Vite is about to inline into the bundle as `import.meta.env`.
        Anything else — `process.env`, a second `loadEnv` call with different
        arguments — can differ from what the application was compiled with, and
        a `connect-src` that differs from what the application fetches is a
        policy that only breaks in production.
      */
      connectSrc = connectSourcesFromEnv(config.env as Record<string, string | undefined>);
    },

    configureServer(server) {
      /*
        Registered here, in the hook body, rather than in the function
        `configureServer` can return — which would place it *after* Vite's own
        middlewares, where `indexHtmlMiddleware` has already answered.

        The middleware serves the HTML itself rather than rewriting a response
        on the way out. Both are possible; this one is possible *twice*, because
        `vite preview` puts a compression middleware in front of its static
        handler and a response rewriter would be handed gzipped bytes. It also
        means the substitution cannot be bypassed: there is no code path that
        serves this document without a nonce.

        And no dot-path deny here, unlike the preview server below, because a
        dev server's URL space is not a directory listing: Vite serves every
        pre-bundled dependency from `/node_modules/.vite/deps/`, so denying
        dot-segments in development returned 403 for React itself and every page
        went blank. Caught by the E2E suite rather than by anything in this
        file. Nothing is lost by the asymmetry — the dot-directories the rule
        exists for are `dist/.csp/` and `dist/.vite/`, which a build produces
        and a dev server never serves, and Vite's own `server.fs.deny` already
        covers `.env` and key material.
      */
      server.middlewares.use(
        createCspHtmlMiddleware({
          loadHtml: devHtmlLoader(server, root),
          connectSrc,
          development: true,
          randomBytes: random,
          skipPrefixes: devProxyPrefixes,
          requireHtmlAccept: true,
        }),
      );
    },

    configurePreviewServer(server) {
      server.middlewares.use(createDenyDotPathsMiddleware());
      server.middlewares.use(
        createCspHtmlMiddleware({
          loadHtml: previewHtmlLoader(path.resolve(root, outDir)),
          connectSrc,
          /*
            `development: false`, even though this is a local server. `preview`
            serves a production build, and the one thing worth testing is the
            policy production will enforce. If the devtools' injected stylesheet
            or an HMR socket were needed here, that would be a finding rather
            than a reason to loosen it — and `e2e/csp.spec.ts` runs against this
            server precisely so that finding arrives as a red check.
          */
          development: false,
          randomBytes: random,
          skipPrefixes: previewProxyPrefixes,
          requireHtmlAccept: false,
        }),
      );
    },

    generateBundle: {
      order: "post",
      handler(_outputOptions, bundle) {
        for (const [fileName, output] of Object.entries(bundle)) {
          if (!fileName.endsWith(".html")) continue;
          if (output.type !== "asset") continue;
          const html =
            typeof output.source === "string"
              ? output.source
              : Buffer.from(output.source).toString("utf8");
          const problems = auditNoncedHtml(html);
          if (problems.length > 0) {
            this.error(
              `${fileName} contains markup the Content-Security-Policy would block:\n` +
                problems.map((p) => `  - ${p}`).join("\n") +
                `\nSee docs/csp.md.`,
            );
          }
        }

        const nginxPolicy = cspHeaderValue({
          nonce: NGINX_NONCE_VARIABLE,
          connectSrc,
          development: false,
        });
        this.emitFile({
          type: "asset",
          fileName: POLICY_CONF_FILE,
          source: renderNginxSnippet(nginxPolicy),
        });
        this.emitFile({
          type: "asset",
          fileName: POLICY_TXT_FILE,
          source: `${cspHeaderValue({
            nonce: NONCE_PLACEHOLDER,
            connectSrc,
            development: false,
          })}\n`,
        });
      },
    },
  };
}

/** The generated nginx include. */
export function renderNginxSnippet(policy: string): string {
  return [
    "# Generated by tooling/csp/vitePlugin.ts from the build's own resolved",
    "# environment. Do not edit: `connect-src` has to name the same origins the",
    "# bundle was compiled against, and only the build knows what those were.",
    "#",
    `# Expects ${NGINX_NONCE_VARIABLE} to be set before this file is included.`,
    `set $csp_policy "${policy}";`,
    "",
  ].join("\n");
}

/**
 * HTML the policy would break, as a list of complaints.
 *
 * Vite nonces every tag it generates itself, so in a passing build this gate
 * finds nothing — which is exactly when a gate should be added. What it is
 * waiting for is the next plugin: `transformIndexHtml` hooks run after Vite's
 * own nonce pass, so a plugin that appends a `<script>` appends it *without* a
 * nonce, and under `'strict-dynamic'` that script silently never runs. Nothing
 * else in this repository would notice — the build succeeds, the bundle is
 * complete, and the page is missing whatever that script did.
 *
 * Scanning with a regular expression rather than a parser, deliberately: the
 * input is machine-generated HTML from one template, the check only needs tag
 * openings, and a false positive here fails a build with a precise message
 * while a missed tag ships a broken page. The asymmetry picks the tool.
 */
export function auditNoncedHtml(html: string): string[] {
  const problems: string[] = [];
  const nonceAttribute = `nonce="${NONCE_PLACEHOLDER}"`;

  const tagPattern = /<(script|style|link)\b([^>]*)>/gi;
  for (const match of html.matchAll(tagPattern)) {
    const [tag, name = "", attributes = ""] = match;
    const lowered = name.toLowerCase();
    if (
      lowered === "link" &&
      !/\brel=["']?(stylesheet|modulepreload|preload)\b/i.test(attributes)
    ) {
      continue;
    }
    if (!attributes.includes(nonceAttribute)) {
      problems.push(`<${lowered}> without ${nonceAttribute}: ${collapse(tag)}`);
    }
  }

  // `script-src-attr` falls back to `script-src`, which carries no
  // `'unsafe-inline'`, so an inline handler in the shell would be dead markup.
  for (const match of html.matchAll(/<[a-z][^>]*?\s(on[a-z]+)\s*=/gi)) {
    problems.push(`inline event handler ${match[1] ?? ""}=: ${collapse(match[0])}`);
  }

  for (const match of html.matchAll(/\b(?:href|src|action)\s*=\s*["']?\s*javascript:/gi)) {
    problems.push(`javascript: URL: ${collapse(match[0])}`);
  }

  // Vite's module-preload helper copies the nonce out of this tag onto the
  // `<link>` elements it injects for a lazy chunk. Without it those links are
  // unnonced, and under `'strict-dynamic'` the preload is refused — which costs
  // a round trip rather than correctness, and so would never be noticed.
  if (!/<meta[^>]+property=["']csp-nonce["']/i.test(html)) {
    problems.push(`no <meta property="csp-nonce"> — html.cspNonce is not set`);
  }

  return problems;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Minimal shapes, so the middleware is testable without a server. */
export interface CspRequest {
  method?: string | undefined;
  url?: string | undefined;
  originalUrl?: string | undefined;
  headers: { accept?: string | undefined };
}

export interface CspResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

export interface HtmlShellRequestOptions {
  /**
   * Path prefixes this middleware must not answer — the keys of the server's
   * proxy table, which is the configuration's way of saying "this path is
   * somebody else's". nginx says the same thing with a `location` block that
   * out-ranks `try_files`.
   */
  readonly skipPrefixes: readonly string[];
  /**
   * Whether a request has to ask for `text/html` to count as a navigation.
   *
   * `true` for the dev server and `false` for `vite preview`, and the asymmetry
   * is not a convenience. In development the URL space contains Vite's own
   * extension-less endpoints — `/@vite/client`, `/@react-refresh` — and the
   * `Accept` header is the only thing separating them from an application
   * route. A preview has no such endpoints, and requiring the header there
   * would be a bug: the service worker precaches `/index.html` with `fetch()`,
   * whose `Accept` is a wildcard, so the entry it stored would be the
   * *unsubstituted* document — an offline visit on which nothing executes.
   */
  readonly requireHtmlAccept: boolean;
}

export interface CspHtmlMiddlewareOptions extends HtmlShellRequestOptions {
  /** Resolves a request to HTML, or `null` when it is not this one's to answer. */
  readonly loadHtml: (pathname: string, req: CspRequest) => Promise<string | null>;
  readonly connectSrc: readonly string[];
  readonly development: boolean;
  readonly randomBytes: (size: number) => Uint8Array;
}

/**
 * True for requests that would be answered with the SPA shell.
 *
 * The same questions nginx's `try_files $uri $uri/ /index.html` answers, in the
 * same order, because the point of filling the nonce in locally is that the
 * local servers behave like the deployed one: not a proxied path, and not a
 * request for a file that has an extension of its own.
 */
export function wantsHtmlShell(req: CspRequest, options: HtmlShellRequestOptions): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const pathname = pathnameOf(req.url ?? "/");
  if (options.skipPrefixes.some((prefix) => pathname.startsWith(prefix))) return false;
  if (options.requireHtmlAccept && !(req.headers.accept ?? "").includes("text/html")) return false;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (lastSegment.includes(".") && !lastSegment.endsWith(".html")) return false;
  return true;
}

/** The pathname of a server-relative URL, without the query or hash. */
export function pathnameOf(url: string): string {
  const end = url.search(/[?#]/);
  const pathname = end === -1 ? url : url.slice(0, end);
  return pathname === "" ? "/" : pathname;
}

export function createCspHtmlMiddleware(options: CspHtmlMiddlewareOptions) {
  return function cspHtmlMiddleware(
    req: CspRequest,
    res: CspResponse,
    next: (error?: unknown) => void,
  ): void {
    if (!wantsHtmlShell(req, options)) {
      next();
      return;
    }

    void (async () => {
      let html: string | null;
      try {
        html = await options.loadHtml(pathnameOf(req.url ?? "/"), req);
      } catch (error) {
        next(error);
        return;
      }
      if (html === null) {
        next();
        return;
      }

      const nonce = createNonce(options.randomBytes);
      const body = html.split(NONCE_PLACEHOLDER).join(nonce);

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      /*
        The one cache header the policy depends on. A nonce reused across two
        visitors is not a nonce, so the document carrying it may never be
        stored by a shared cache or by the browser's own. The hashed assets it
        references stay immutable — they carry no nonce, which is the reason
        the substitution happens in the HTML and nowhere else.
      */
      res.setHeader("Cache-Control", "no-store");
      res.setHeader(
        "Content-Security-Policy",
        cspHeaderValue({
          nonce,
          connectSrc: options.connectSrc,
          development: options.development,
        }),
      );
      res.setHeader("Content-Length", String(Buffer.byteLength(body)));
      res.end(req.method === "HEAD" ? undefined : body);
    })();
  };
}

/**
 * Refuses every dot-path. Installed on `vite preview` only — see
 * {@link csp}'s `configureServer` for why a dev server must not have it.
 *
 * `dist/` holds two dot-directories that are build metadata rather than
 * payload: `.vite/manifest.json`, which the bundle-budget gate reads, and
 * `.csp/policy.conf`, which this plugin writes for the web server to include.
 * `vite preview` served both with a 200 — found by `e2e/csp.spec.ts`, which is
 * the sort of thing only a test that actually asks can tell you, and a
 * particularly poor failure for a change whose subject is the security
 * posture: it would have published the security posture.
 *
 * `nginx.conf` has the same rule, and the reason this one exists is that a
 * local server should not be more permissive than the deployed one. Not a 404:
 * a dot-path is refused rather than absent, which is what nginx's `deny all`
 * says too.
 */
export function createDenyDotPathsMiddleware() {
  return function denyDotPaths(req: CspRequest, res: CspResponse, next: () => void): void {
    const pathname = pathnameOf(req.url ?? "/");
    if (!pathname.split("/").some((segment) => segment.startsWith("."))) {
      next();
      return;
    }
    res.statusCode = 403;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("403 Forbidden\n");
  };
}

/**
 * Development: Vite's own transform, then the substitution.
 *
 * `server.transformIndexHtml` is what `indexHtmlMiddleware` calls, with the
 * same arguments, so what comes back is what Vite would have served — the
 * react-refresh preamble, the HMR client, the nonce attributes — and this
 * loader adds nothing but the replacement.
 */
export function devHtmlLoader(
  server: Pick<ViteDevServer, "transformIndexHtml">,
  root: string,
): (pathname: string, req: CspRequest) => Promise<string | null> {
  return async (pathname, req) => {
    const raw = await readFile(path.join(root, "index.html"), "utf8");
    return server.transformIndexHtml(pathname, raw, req.originalUrl);
  };
}

/** `vite preview`: the built shell, straight off disk. */
export function previewHtmlLoader(distDir: string): (pathname: string) => Promise<string | null> {
  return async (pathname) => {
    const requested = pathname.endsWith(".html") ? pathname : "/index.html";
    const resolved = path.resolve(distDir, `.${requested}`);
    // `path.resolve` collapses `..`, so this is the check that `/../../etc`
    // cannot reach outside the served directory.
    if (resolved !== distDir && !resolved.startsWith(distDir + path.sep)) return null;
    try {
      return await readFile(resolved, "utf8");
    } catch {
      return null;
    }
  };
}
