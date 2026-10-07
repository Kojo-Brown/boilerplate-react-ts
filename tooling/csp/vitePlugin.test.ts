// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { NONCE_PLACEHOLDER } from "./policy.ts";
import {
  NGINX_NONCE_VARIABLE,
  auditNoncedHtml,
  createCspHtmlMiddleware,
  createDenyDotPathsMiddleware,
  devHtmlLoader,
  pathnameOf,
  previewHtmlLoader,
  renderNginxSnippet,
  wantsHtmlShell,
} from "./vitePlugin.ts";

const NONCED = `nonce="${NONCE_PLACEHOLDER}"`;
const META = `<meta property="csp-nonce" ${NONCED}>`;

describe("auditNoncedHtml", () => {
  it("passes the shell Vite actually emits", () => {
    expect(
      auditNoncedHtml(
        `<html><head>${META}` +
          `<script type="module" src="/assets/index.js" ${NONCED}></script>` +
          `<link rel="stylesheet" href="/assets/index.css" ${NONCED}>` +
          `<link rel="modulepreload" href="/assets/router.js" ${NONCED}>` +
          `<link rel="icon" href="/favicon.svg">` +
          `</head><body><div id="root"></div></body></html>`,
      ),
    ).toEqual([]);
  });

  it("catches a script another plugin appended after Vite's nonce pass", () => {
    // The failure this gate exists for: `transformIndexHtml` post hooks run
    // after Vite's own, so a plugin that appends a tag appends it unnonced and
    // under `'strict-dynamic'` that script silently never runs.
    const problems = auditNoncedHtml(`<html><head>${META}<script src="/late.js"></script></head>`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("<script> without");
  });

  it("catches an unnonced inline style and stylesheet link", () => {
    expect(auditNoncedHtml(`${META}<style>body{color:red}</style>`)).toHaveLength(1);
    expect(auditNoncedHtml(`${META}<link rel="stylesheet" href="/a.css">`)).toHaveLength(1);
  });

  it("ignores a link the policy does not govern by nonce", () => {
    // `rel="icon"` is an `img-src` fetch; a nonce on it means nothing.
    expect(auditNoncedHtml(`${META}<link rel="icon" href="/favicon.svg">`)).toEqual([]);
    expect(auditNoncedHtml(`${META}<link rel="manifest" href="/app.webmanifest">`)).toEqual([]);
  });

  it("catches an inline event handler", () => {
    // `script-src-attr` falls back to `script-src`, which has no
    // `'unsafe-inline'`, so this is dead markup rather than a working handler.
    const problems = auditNoncedHtml(`${META}<body onload="boot()"></body>`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("inline event handler onload=");
  });

  it("catches a javascript: URL", () => {
    const problems = auditNoncedHtml(`${META}<a href="javascript:alert(1)">x</a>`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("javascript: URL");
  });

  it("catches html.cspNonce being off entirely", () => {
    // Without the meta tag, Vite's preload helper has no nonce to copy onto
    // the `<link>`s it injects for a lazy chunk.
    expect(auditNoncedHtml(`<html><head></head></html>`)).toEqual([
      `no <meta property="csp-nonce"> — html.cspNonce is not set`,
    ]);
  });
});

describe("renderNginxSnippet", () => {
  it("defines $csp_policy and says what it expects to already be set", () => {
    const snippet = renderNginxSnippet("default-src 'none'");
    expect(snippet).toContain(`set $csp_policy "default-src 'none'";`);
    expect(snippet).toContain(NGINX_NONCE_VARIABLE);
    expect(snippet).toMatch(/^#/);
  });
});

describe("pathnameOf", () => {
  it("drops the query and the hash", () => {
    expect(pathnameOf("/labs/images?variant=webp#top")).toBe("/labs/images");
    expect(pathnameOf("")).toBe("/");
  });
});

describe("wantsHtmlShell", () => {
  const dev = { skipPrefixes: ["/api"], requireHtmlAccept: true };
  const preview = { skipPrefixes: ["/api"], requireHtmlAccept: false };
  const navigation = { method: "GET", headers: { accept: "text/html,*/*;q=0.8" } };

  it("answers a navigation", () => {
    expect(wantsHtmlShell({ ...navigation, url: "/" }, dev)).toBe(true);
    expect(wantsHtmlShell({ ...navigation, url: "/labs/images" }, dev)).toBe(true);
    expect(wantsHtmlShell({ ...navigation, url: "/index.html" }, dev)).toBe(true);
  });

  it("leaves a file with an extension alone", () => {
    expect(wantsHtmlShell({ ...navigation, url: "/assets/index.js" }, dev)).toBe(false);
    expect(wantsHtmlShell({ ...navigation, url: "/favicon.svg" }, dev)).toBe(false);
  });

  it("leaves a proxied path alone", () => {
    // Vite's proxy middleware is installed after this one, so without the skip
    // list a browser opening `/api/posts` would be handed the SPA shell.
    expect(wantsHtmlShell({ ...navigation, url: "/api/posts" }, dev)).toBe(false);
  });

  it("leaves a write alone", () => {
    expect(wantsHtmlShell({ ...navigation, method: "POST", url: "/" }, dev)).toBe(false);
  });

  it("requires text/html in development only", () => {
    // Development: `/@vite/client` and `/@react-refresh` have no extension, and
    // the Accept header is the only thing separating them from a route.
    const moduleRequest = { method: "GET", url: "/@vite/client", headers: { accept: "*/*" } };
    expect(wantsHtmlShell(moduleRequest, dev)).toBe(false);

    // Preview: the service worker precaches `/index.html` with `fetch()`, whose
    // Accept is a wildcard. Requiring the header there would store an
    // unsubstituted document and leave an offline visit with nothing running.
    const precache = { method: "GET", url: "/index.html", headers: { accept: "*/*" } };
    expect(wantsHtmlShell(precache, dev)).toBe(false);
    expect(wantsHtmlShell(precache, preview)).toBe(true);
  });
});

interface Recorded {
  statusCode: number;
  headers: Record<string, string>;
  body: string | undefined;
  /** `"end"` when the middleware answered, `"next"` when it passed the request on. */
  outcome: "end" | "next" | "error";
  error: unknown;
}

/**
 * Drives the middleware to completion.
 *
 * Resolving on `end`/`next` rather than on a timer, so a middleware that
 * silently did neither fails the test by timing out instead of passing with an
 * empty recording.
 */
function run(
  handler: ReturnType<typeof createCspHtmlMiddleware>,
  req: Parameters<ReturnType<typeof createCspHtmlMiddleware>>[0],
): Promise<Recorded> {
  const recorded: Recorded = {
    statusCode: 0,
    headers: {},
    body: undefined,
    outcome: "next",
    error: undefined,
  };
  return new Promise<Recorded>((resolve) => {
    handler(
      req,
      {
        get statusCode() {
          return recorded.statusCode;
        },
        set statusCode(value: number) {
          recorded.statusCode = value;
        },
        setHeader(name: string, value: string) {
          recorded.headers[name] = value;
        },
        end(body?: string) {
          recorded.body = body;
          recorded.outcome = "end";
          resolve(recorded);
        },
      },
      (error?: unknown) => {
        recorded.outcome = error === undefined ? "next" : "error";
        recorded.error = error;
        resolve(recorded);
      },
    );
  });
}

function middleware(html: string | null, overrides: { development?: boolean } = {}) {
  let n = 0;
  return createCspHtmlMiddleware({
    loadHtml: () => Promise.resolve(html),
    connectSrc: ["https://api.example.com"],
    development: overrides.development ?? false,
    // Counts up, so two responses from one handler are guaranteed to differ —
    // which is the property the per-request test is about.
    randomBytes: (size) => new Uint8Array(size).fill((n += 1)),
    skipPrefixes: [],
    requireHtmlAccept: false,
  });
}

const GET_HTML = { method: "GET", url: "/", headers: { accept: "text/html" } };

describe("createCspHtmlMiddleware", () => {
  it("substitutes every placeholder and sends the matching header", async () => {
    const recorded = await run(
      middleware(`<html><head>${META}<script ${NONCED}></script></head></html>`),
      GET_HTML,
    );

    expect(recorded.outcome).toBe("end");
    expect(recorded.body).not.toContain(NONCE_PLACEHOLDER);
    const nonces = [...(recorded.body ?? "").matchAll(/nonce="([^"]*)"/g)].map((m) => m[1]);
    expect(nonces).toHaveLength(2);
    expect(new Set(nonces).size).toBe(1);
    // The contract: the value in the document is the value in the header.
    expect(recorded.headers["Content-Security-Policy"]).toContain(`'nonce-${nonces[0] ?? ""}'`);
    expect(recorded.headers["Content-Security-Policy"]).toContain("https://api.example.com");
    expect(recorded.headers["Cache-Control"]).toBe("no-store");
    expect(recorded.headers["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(recorded.headers["Content-Length"]).toBe(String(Buffer.byteLength(recorded.body ?? "")));
    expect(recorded.statusCode).toBe(200);
  });

  it("mints a different nonce for every response", async () => {
    const handler = middleware(META);
    const first = await run(handler, GET_HTML);
    const second = await run(handler, GET_HTML);
    expect(first.headers["Content-Security-Policy"]).not.toBe(
      second.headers["Content-Security-Policy"],
    );
    expect(first.body).not.toBe(second.body);
  });

  it("sends no body for a HEAD, but still sends the policy", async () => {
    const recorded = await run(middleware(META), { ...GET_HTML, method: "HEAD" });
    expect(recorded.outcome).toBe("end");
    expect(recorded.body).toBeUndefined();
    expect(recorded.headers["Content-Security-Policy"]).toContain("default-src 'none'");
  });

  it("passes the request on when the loader declines it", async () => {
    const recorded = await run(middleware(null), GET_HTML);
    expect(recorded.outcome).toBe("next");
    expect(recorded.statusCode).toBe(0);
  });

  it("hands a loader failure to the error middleware rather than serving a half-page", async () => {
    const recorded = await run(
      createCspHtmlMiddleware({
        loadHtml: () => Promise.reject(new Error("no index.html")),
        connectSrc: [],
        development: false,
        randomBytes: (size) => new Uint8Array(size),
        skipPrefixes: [],
        requireHtmlAccept: false,
      }),
      GET_HTML,
    );
    expect(recorded.outcome).toBe("error");
    expect(recorded.error).toBeInstanceOf(Error);
    expect(recorded.body).toBeUndefined();
  });

  it("serves the development policy when asked to", async () => {
    const recorded = await run(middleware(META, { development: true }), GET_HTML);
    expect(recorded.headers["Content-Security-Policy"]).toContain("ws:");
    expect(recorded.headers["Content-Security-Policy"]).not.toContain("upgrade-insecure-requests");
  });

  it("does not answer what it was told to skip", async () => {
    const recorded = await run(
      createCspHtmlMiddleware({
        loadHtml: () => Promise.resolve(META),
        connectSrc: [],
        development: false,
        randomBytes: (size) => new Uint8Array(size),
        skipPrefixes: ["/api"],
        requireHtmlAccept: false,
      }),
      { ...GET_HTML, url: "/api/posts" },
    );
    expect(recorded.outcome).toBe("next");
  });
});

describe("previewHtmlLoader", () => {
  let dist: string;

  beforeAll(() => {
    dist = mkdtempSync(path.join(tmpdir(), "csp-preview-"));
    writeFileSync(path.join(dist, "index.html"), "<html>shell</html>");
    mkdirSync(path.join(dist, "nested"));
    writeFileSync(path.join(dist, "nested", "page.html"), "<html>nested</html>");
    writeFileSync(path.join(path.dirname(dist), "outside.html"), "<html>outside</html>");
  });

  it("answers a route with the shell", async () => {
    await expect(previewHtmlLoader(dist)("/labs/images")).resolves.toBe("<html>shell</html>");
  });

  it("answers an explicit .html path with that file", async () => {
    await expect(previewHtmlLoader(dist)("/nested/page.html")).resolves.toBe("<html>nested</html>");
  });

  it("declines a path that escapes the served directory", async () => {
    await expect(previewHtmlLoader(dist)("/../outside.html")).resolves.toBeNull();
  });

  it("declines an .html file that is not there", async () => {
    await expect(previewHtmlLoader(dist)("/missing.html")).resolves.toBeNull();
  });
});

describe("devHtmlLoader", () => {
  it("runs the raw index.html through Vite's own transform", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "csp-dev-"));
    writeFileSync(path.join(root, "index.html"), "<html>raw</html>");
    const seen: [string, string, string | undefined][] = [];
    const html = await devHtmlLoader(
      {
        transformIndexHtml: (url: string, raw: string, originalUrl?: string) => {
          seen.push([url, raw, originalUrl]);
          return Promise.resolve(`${raw}<!--transformed-->`);
        },
      },
      root,
    )("/about", { method: "GET", url: "/about", originalUrl: "/about", headers: {} });

    expect(html).toBe("<html>raw</html><!--transformed-->");
    expect(seen).toEqual([["/about", "<html>raw</html>", "/about"]]);
  });
});

describe("createDenyDotPathsMiddleware", () => {
  function visit(url: string): { statusCode: number; outcome: "end" | "next"; body?: string } {
    const result: { statusCode: number; outcome: "end" | "next"; body?: string } = {
      statusCode: 0,
      outcome: "next",
    };
    createDenyDotPathsMiddleware()(
      { method: "GET", url, headers: {} },
      {
        get statusCode() {
          return result.statusCode;
        },
        set statusCode(value: number) {
          result.statusCode = value;
        },
        setHeader() {
          /* recorded nowhere: the status is the assertion */
        },
        end(body?: string) {
          result.outcome = "end";
          result.body = body;
        },
      },
      () => {
        result.outcome = "next";
      },
    );
    return result;
  }

  it("refuses the dot-directories dist/ carries", () => {
    // `vite preview` served both of these with a 200 until this existed.
    expect(visit("/.csp/policy.conf")).toMatchObject({ outcome: "end", statusCode: 403 });
    expect(visit("/.vite/manifest.json")).toMatchObject({ outcome: "end", statusCode: 403 });
  });

  it("refuses a dot-segment anywhere in the path", () => {
    expect(visit("/assets/.secret").statusCode).toBe(403);
  });

  it("refuses rather than 404s, which is what nginx's `deny all` also says", () => {
    expect(visit("/.csp/policy.conf").statusCode).not.toBe(404);
  });

  it("lets everything else through, including a dotted filename", () => {
    for (const url of ["/", "/labs/images", "/assets/index-a1b2.js", "/favicon.svg"]) {
      expect(visit(url), url).toMatchObject({ outcome: "next", statusCode: 0 });
    }
  });

  it("would refuse Vite's pre-bundled dependencies, which is why dev does not get it", () => {
    // Not an aspiration — a regression test for a bug this caused. A dev
    // server serves every optimized dependency from `/node_modules/.vite/deps/`,
    // so installing this there returned 403 for React and every page went
    // blank. It is on `vite preview` only.
    expect(visit("/node_modules/.vite/deps/react.js").statusCode).toBe(403);
  });

  it("ignores the query when deciding", () => {
    expect(visit("/labs/images?x=.y").statusCode).toBe(0);
  });
});
