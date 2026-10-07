// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  CONNECT_SRC_ENV_KEYS,
  ENV_FALLBACKS,
  DEVELOPMENT_RELAXATIONS,
  DIRECTIVE_ORDER,
  NONCE_BYTE_LENGTH,
  NONCE_PLACEHOLDER,
  buildPolicy,
  connectSourcesFromEnv,
  createNonce,
  cspHeaderValue,
  serializePolicy,
} from "./policy.ts";

const NONCE = "test-nonce";

function production(connectSrc: readonly string[] = []) {
  return buildPolicy({ nonce: NONCE, connectSrc });
}

describe("buildPolicy", () => {
  it("refuses everything by default and then enumerates", () => {
    // The shape of the whole policy: a directive nobody thought about inherits
    // a refusal rather than a permission.
    expect(production().get("default-src")).toEqual(["'none'"]);
    // Every fetch directive the application needs is spelled out, so adding a
    // destination is a visible change here rather than a silent inheritance.
    for (const directive of [
      "script-src",
      "style-src",
      "img-src",
      "font-src",
      "connect-src",
      "worker-src",
      "manifest-src",
      "media-src",
      "frame-src",
    ] as const) {
      expect(production().has(directive)).toBe(true);
    }
  });

  it("carries the nonce on scripts and styles, and `strict-dynamic` on scripts only", () => {
    const policy = production();
    expect(policy.get("script-src")).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    // `'strict-dynamic'` is undefined for styles; `'self'` is what loads the
    // one compiled stylesheet.
    expect(policy.get("style-src")).toEqual(["'self'", `'nonce-${NONCE}'`]);
  });

  it("names no origin it was not given", () => {
    expect(production().get("connect-src")).toEqual(["'self'"]);
    expect(production(["https://api.example.com"]).get("connect-src")).toEqual([
      "'self'",
      "https://api.example.com",
    ]);
  });

  it("does not repeat an origin", () => {
    expect(
      production(["https://api.example.com", "https://api.example.com"]).get("connect-src"),
    ).toEqual(["'self'", "https://api.example.com"]);
  });

  it("blocks framing in both directions", () => {
    // `frame-ancestors` so nothing frames this app; `frame-src` so it frames
    // nothing. A clickjacking defence that only does the first half leaves the
    // app itself as the frame host.
    expect(production().get("frame-ancestors")).toEqual(["'none'"]);
    expect(production().get("frame-src")).toEqual(["'none'"]);
  });

  it("upgrades insecure requests in production and not in development", () => {
    expect(production().has("upgrade-insecure-requests")).toBe(true);
    // The dev server is plain `http://localhost` and the mock API is a second
    // plain-HTTP origin; upgrading either breaks the whole environment.
    expect(buildPolicy({ nonce: NONCE, development: true }).has("upgrade-insecure-requests")).toBe(
      false,
    );
  });

  it("keeps every development relaxation out of the production policy", () => {
    // The gate that matters. A relaxation leaking from a dev config into the
    // shipped one is the ordinary way a strict CSP stops being strict, and it
    // leaks silently: the dev server is the only place anybody would notice a
    // policy being too *tight*.
    const shipped = serializePolicy(production());
    for (const relaxation of Object.keys(DEVELOPMENT_RELAXATIONS)) {
      expect(shipped).not.toContain(relaxation);
    }
  });

  it("applies each development relaxation where it belongs", () => {
    const dev = buildPolicy({ nonce: NONCE, development: true });
    // The HMR socket, which `'self'` does not cover because of the scheme.
    expect(dev.get("connect-src")).toContain("ws:");
    // React Query Devtools injects a `<style>` with no nonce it could know.
    expect(dev.get("style-src")).toContain("'unsafe-inline'");
    // And not on scripts, which is the relaxation that would matter.
    expect(dev.get("script-src")).not.toContain("'unsafe-inline'");
    expect(dev.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("never allows an evaluator, in either mode", () => {
    for (const development of [false, true]) {
      expect(serializePolicy(buildPolicy({ nonce: NONCE, development }))).not.toContain(
        "unsafe-eval",
      );
    }
  });
});

describe("serializePolicy", () => {
  it("writes the directives in DIRECTIVE_ORDER, as one header value", () => {
    const header = cspHeaderValue({ nonce: NONCE });
    expect(header).not.toContain("\n");
    const written = header.split("; ").map((part) => part.split(" ")[0]);
    expect(written).toEqual(DIRECTIVE_ORDER.filter((d) => written.includes(d)));
  });

  it("writes a valueless directive as its own name", () => {
    expect(cspHeaderValue({ nonce: NONCE })).toContain("; upgrade-insecure-requests");
  });

  it("interpolates whatever nonce expression it is handed, including nginx's", () => {
    // The reason the nonce is a parameter: the same serializer produces a
    // browser header and a line of nginx configuration.
    expect(cspHeaderValue({ nonce: "$csp_nonce" })).toContain("'nonce-$csp_nonce'");
  });
});

describe("connectSourcesFromEnv", () => {
  it("reduces each configured URL to its origin", () => {
    // Origins, never paths: a CSP source expression with a path matches by
    // prefix, so `…/v1` would admit `/v1-staging`.
    expect(
      connectSourcesFromEnv({
        VITE_API_URL: "https://api.example.com/v1",
        VITE_ANALYTICS_URL: "https://vitals.example.com/collect",
      }),
    ).toEqual(["https://api.example.com", "https://vitals.example.com"]);
  });

  it("keeps the port, which is a different origin", () => {
    expect(connectSourcesFromEnv({ VITE_API_URL: "http://localhost:4000" })).toEqual([
      "http://localhost:4000",
    ]);
  });

  it("collapses two keys that name one origin", () => {
    expect(
      connectSourcesFromEnv({
        VITE_API_URL: "https://api.example.com",
        VITE_ERROR_REPORT_URL: "https://api.example.com/errors",
      }),
    ).toEqual(["https://api.example.com"]);
  });

  it("drops empty, missing and unparseable values", () => {
    // `env.ts` validates these with Zod at boot; failing here would replace a
    // good error message with a worse one.
    expect(
      connectSourcesFromEnv({
        VITE_API_URL: "",
        VITE_ANALYTICS_URL: "not a url",
        VITE_ERROR_REPORT_URL: undefined,
      }),
    ).toEqual([]);
  });

  it("falls back to the defaults the application's schema applies", () => {
    // The bug this exists for: an unset variable is absent from Vite's env and
    // *present* in the bundle, because `env.ts` defaults it. A policy built
    // from the env alone said `'self'` while the application fetched
    // `http://localhost:4000`, and refused every one of its own requests.
    expect(connectSourcesFromEnv({})).toEqual([ENV_FALLBACKS.VITE_API_URL]);
    // And a configured value still wins over the default.
    expect(connectSourcesFromEnv({ VITE_API_URL: "https://api.example.com" })).toEqual([
      "https://api.example.com",
    ]);
  });

  it("has a fallback for every key it reads", () => {
    // Otherwise the next key added here reintroduces the bug above.
    expect(Object.keys(ENV_FALLBACKS).sort()).toEqual([...CONNECT_SRC_ENV_KEYS].sort());
  });

  it("drops an opaque origin rather than writing the string `null`", () => {
    expect(connectSourcesFromEnv({ VITE_API_URL: "data:text/plain,x" })).toEqual([]);
  });

  it("reads only the keys the application turns into requests", () => {
    // `VITE_REDIRECT_URI` is somewhere the provider navigates *to*, so no
    // fetch directive governs it; `VITE_AUTH_DOMAIN` is read by nothing.
    expect(CONNECT_SRC_ENV_KEYS).toEqual([
      "VITE_API_URL",
      "VITE_ANALYTICS_URL",
      "VITE_ERROR_REPORT_URL",
    ]);
    expect(
      connectSourcesFromEnv({
        VITE_REDIRECT_URI: "https://app.example.com/auth/callback",
        VITE_AUTH_DOMAIN: "https://tenant.eu.auth0.com",
      }),
    ).toEqual([ENV_FALLBACKS.VITE_API_URL]);
  });

  it("is deterministic, so a build does not churn the generated policy", () => {
    const forwards = connectSourcesFromEnv({
      VITE_API_URL: "https://b.example.com",
      VITE_ANALYTICS_URL: "https://a.example.com",
    });
    expect(forwards).toEqual(["https://a.example.com", "https://b.example.com"]);
  });
});

describe("createNonce", () => {
  it("asks for 128 bits and base64-encodes them", () => {
    const sizes: number[] = [];
    const nonce = createNonce((size) => {
      sizes.push(size);
      return new Uint8Array(size).fill(0);
    });
    expect(sizes).toEqual([NONCE_BYTE_LENGTH]);
    expect(NONCE_BYTE_LENGTH * 8).toBe(128);
    expect(nonce).toBe("AAAAAAAAAAAAAAAAAAAAAA==");
  });

  it("produces something the `base64-value` grammar accepts", () => {
    let seed = 7;
    const nonce = createNonce((size) =>
      Uint8Array.from({ length: size }, () => (seed = (seed * 31 + 17) % 251)),
    );
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});

describe("NONCE_PLACEHOLDER", () => {
  it("is not a plausible nonce", () => {
    // If the substitution is ever skipped the page must fail closed. A
    // placeholder that looked like a nonce would instead ship one constant
    // value shared by every visitor, which an attacker can read out of the
    // document — strictly worse than having no nonce at all.
    expect(NONCE_PLACEHOLDER).not.toMatch(/^[A-Za-z0-9+/]{16,}={0,2}$/);
  });
});
