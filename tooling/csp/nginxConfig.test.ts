// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { NONCE_PLACEHOLDER } from "./policy.ts";
import { NGINX_NONCE_VARIABLE, POLICY_CONF_FILE, renderNginxSnippet } from "./vitePlugin.ts";

/**
 * The contract between the build and the server it is deployed behind.
 *
 * Nothing in CI runs nginx, so this cannot prove the configuration *works* —
 * `nginx -t` would be a job of its own and a container runtime to go with it.
 * What it can prove is the part that would otherwise rot silently: the three
 * names the two halves have to agree on, and the three decisions the policy
 * depends on being true of the server.
 *
 * Every assertion here corresponds to a way the deployed application breaks
 * while every other gate stays green:
 *
 * - a renamed nonce variable → `$csp_policy` interpolates an empty string, so
 *   the header says `'nonce-'` and nothing on the page runs;
 * - a renamed placeholder → `sub_filter` matches nothing, same outcome;
 * - a missing `include` → nginx refuses to start, which is the *good* failure
 *   and is only good because the file is generated rather than hand-written;
 * - a cacheable shell → two visitors share a nonce, which is not a nonce;
 * - a fetchable `dist/.csp/` → the generated policy, and the asset manifest
 *   beside it, are readable by anyone.
 */
const ROOT = new URL("../../", import.meta.url);
const NGINX_CONF = readFileSync(fileURLToPath(new URL("nginx.conf", ROOT)), "utf8");
const DOCKERFILE = readFileSync(fileURLToPath(new URL("Dockerfile", ROOT)), "utf8");

/** Where `nginx.conf` expects the generated snippet to have been copied. */
const INCLUDE_PATH = "/etc/nginx/csp-policy.conf";

describe("nginx.conf", () => {
  it("sets the nonce variable the generated snippet interpolates, before including it", () => {
    const setsNonce = NGINX_CONF.indexOf(`set ${NGINX_NONCE_VARIABLE} $request_id;`);
    const includes = NGINX_CONF.indexOf(`include ${INCLUDE_PATH};`);
    expect(setsNonce).toBeGreaterThan(-1);
    expect(includes).toBeGreaterThan(-1);
    // nginx evaluates `set` in source order during the rewrite phase, so the
    // snippet's `set $csp_policy "… 'nonce-$csp_nonce' …"` has to come second.
    expect(setsNonce).toBeLessThan(includes);
  });

  it("uses the policy variable the generated snippet defines", () => {
    expect(renderNginxSnippet("…")).toContain("set $csp_policy");
    expect(NGINX_CONF).toContain("add_header Content-Security-Policy $csp_policy always;");
  });

  it("substitutes the placeholder the build leaves behind, everywhere it occurs", () => {
    expect(NGINX_CONF).toContain(`sub_filter '${NONCE_PLACEHOLDER}' ${NGINX_NONCE_VARIABLE};`);
    // The shell has eight of them; the default replaces one.
    expect(NGINX_CONF).toContain("sub_filter_once off;");
  });

  it("never stores the document that carries the nonce", () => {
    expect(NGINX_CONF).toMatch(/default\s+"no-store";/);
    expect(NGINX_CONF).toContain("add_header Cache-Control $cache_control always;");
  });

  it("keeps every add_header at server level", () => {
    // The nginx rule this file's header comment is about: an `add_header` at a
    // deeper level drops every inherited one. An `add_header` inside a
    // `location` would therefore serve some path with no CSP at all.
    const insideLocation = NGINX_CONF.split(/^\s*location\b/m)
      .slice(1)
      .filter((block) => /^[^}]*\badd_header\b/.test(block));
    expect(insideLocation).toEqual([]);
  });

  it("refuses to serve the dot-directories dist/ ships", () => {
    expect(NGINX_CONF).toMatch(/location\s+~\s+\/\\\.\s*\{[^}]*deny all;/);
  });
});

describe("Dockerfile", () => {
  it("copies the generated policy to where nginx.conf includes it", () => {
    expect(DOCKERFILE).toContain(`/app/dist/${POLICY_CONF_FILE} ${INCLUDE_PATH}`);
  });
});
