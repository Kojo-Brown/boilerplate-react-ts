# Content-Security-Policy with nonces

A Content-Security-Policy is a list of what this document is allowed to load,
sent as a response header and enforced by the browser. The interesting part of
this one is `script-src`:

```
script-src 'self' 'nonce-TXcPTso+xRqQf9ZFG4a8EQ==' 'strict-dynamic'
```

A **nonce** is a random value minted per response, written into the header and
onto every `<script>` tag the response contains. A script whose `nonce`
attribute matches runs; one that does not, does not. That is what makes it
different from an origin allowlist: `script-src 'self'` still admits anything
same-origin, so an injection that writes `<script src="/uploads/avatar.js">`
executes. With a nonce, an attacker would have to know a value that did not
exist until this request arrived.

`'strict-dynamic'` is what makes the nonce worth having rather than merely
present. It tells the browser to **ignore the host allowlist for scripts** —
`'self'` included — and to extend trust to whatever an already-trusted script
inserts programmatically. The first half closes the same-origin hole; the second
is what a bundler needs, because every lazy route here arrives through an
`import()` from a module that was itself nonced. `'self'` stays beside it for
browsers that do not implement `'strict-dynamic'`: they ignore it and fall back
to same-origin scripts, which is better there than refusing the application.

## Why this is a build concern and not just an nginx one

**A nonce cannot be in a build artefact.** `index.html` is written once and
served a million times; a value baked into it is shared by every visitor and
readable from the document, which is strictly worse than having no nonce at all
because it looks like a defence. So the build leaves a marked hole and the
server fills it:

|                                              |                                                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `tooling/csp/policy.ts`                      | The policy as data. One serializer produces a browser header and a line of nginx configuration.                               |
| `tooling/csp/vitePlugin.ts`                  | Sets `html.cspNonce`, fills the hole on the dev and preview servers, audits the emitted HTML, writes `dist/.csp/policy.conf`. |
| `nginx.conf`                                 | Mints `$csp_nonce` from `$request_id`, substitutes the placeholder with `sub_filter`, sends the header.                       |
| `src/shared/security/reportCspViolations.ts` | Reports what the browser refuses, so the policy can be tightened.                                                             |
| `e2e/csp.spec.ts`                            | The only gate that runs a CSP implementation.                                                                                 |

`html.cspNonce` is the Vite option that does the mechanical half: with it set,
Vite writes `nonce="__CSP_NONCE__"` onto every `<script>`, `<style>` and
`<link rel="stylesheet">` it generates, plus a `<meta property="csp-nonce">`
tag that its own module-preload runtime reads when it injects a `<link>` for a
lazy chunk. Nothing in application code mentions nonces.

**And `connect-src` cannot be in the server config.** `VITE_API_URL`,
`VITE_ANALYTICS_URL` and `VITE_ERROR_REPORT_URL` are inlined into the bundle at
build time, so a hand-written `connect-src` in `nginx.conf` is a second source
of truth for them — and its staleness shows up as every API call failing, in
production only, with the reason visible only in a browser console. So the
build computes the policy from the same resolved environment it compiled the
bundle with and emits it:

```
dist/.csp/policy.conf   # set $csp_policy "…";   — included by nginx.conf
dist/.csp/policy.txt    # the same value as a bare header, for other hosts
```

The `Dockerfile` copies `policy.conf` to `/etc/nginx/csp-policy.conf`, which
`nginx.conf` includes. nginx refuses to start if it is missing, and that is the
right failure: a container that came up with no policy would look healthy.

### The bug that shaped `envDefaults.ts`

The first version read `connect-src` straight from Vite's resolved `env`, which
is correct except for the case that matters. With `VITE_API_URL` unset, the
variable is **absent from the env and present in the bundle** — `env.ts` fills
it in with a Zod `.default()`. The policy came out as `connect-src 'self'`
beside an application fetching `http://localhost:4000`, and every request it
made was refused. The defaults now live in `src/shared/config/envDefaults.ts`
and both the schema and the policy read them from there, with a test asserting
that every key the policy reads has one.

It was found by loading a production build in a browser under the real policy,
which is the only place it is visible. That is what `e2e/csp.spec.ts` is for.

## Dev and preview enforce it too

The plugin installs a middleware on both the dev server and `vite preview` that
serves `index.html` itself: it mints a nonce, substitutes the placeholder, sends
the header, and sets `Cache-Control: no-store`. A policy no test has ever run is
a guess, and the usual outcome of adding a CSP is finding out in production that
it broke something.

It serves the document rather than rewriting the response on the way out,
because `vite preview` puts a compression middleware in front of its static
handler and a response rewriter would be handed gzipped bytes. The side benefit
is that there is no code path that serves this document without a nonce.

**The dev server gets two relaxations, and nothing else.** They are named in
`DEVELOPMENT_RELAXATIONS` with their reasons, and a test asserts that none of
them appears in the production policy — a relaxation leaking from a dev config
into the shipped one is the ordinary way a strict CSP stops being strict, and it
leaks quietly, because the dev server is the only place anybody would notice a
policy being too _tight_.

| Relaxation                  | Why                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `connect-src ws:`           | Vite's HMR socket. `'self'` does not cover a `ws:` scheme even on the same authority.                                         |
| `style-src 'unsafe-inline'` | React Query Devtools injects a `<style>` element with no nonce it could know about. It renders nothing in a production build. |

Neither touches `script-src`, and **no mode gets `'unsafe-eval'`**.
`e2e/csp.spec.ts` therefore runs against the preview server on :3100 — a real
production build under the real production policy — rather than against the dev
server the rest of the E2E suite uses.

## Zod's JIT, and why `shared/config/zod.ts` exists

Zod 4 compiles a specialised parse function for every `z.object()` using
`new Function`, which `script-src` refuses. Zod handles the refusal — it probes
once inside a `try`, caches the answer, and falls back to the interpreted path —
so nothing was broken. What it cost was **one violation report per page load**,
on a channel whose entire value is that something appearing in it means
something is wrong.

`src/shared/config/zod.ts` sets `jitless: true` and re-exports `z`. The flag is
read by each `z.object()` at construction and never again, so importing `z` from
there rather than from `"zod"` is what guarantees the ordering regardless of
module graph; `tooling/csp/zodImports.test.ts` fails if a module reaches past
it. Type-only imports of `"zod"` are exempt — they are erased before a module
graph exists.

## What else the policy decides

- **`default-src 'none'`, then every directive spelled out.** The shorter
  `default-src 'self'` plus overrides says nothing: a directive nobody thought
  about would inherit permission, so the next feature that reaches for a new
  fetch destination is allowed by default and the policy stops describing the
  application.
- **`base-uri 'none'`.** `<base href>` rewrites every relative URL on the page,
  including ones in markup that was already there. Without this, an injected
  `<base>` redirects this application's own `/assets/*` requests.
- **`frame-ancestors 'none'` and `frame-src 'none'`.** Nothing frames this app
  and it frames nothing. A clickjacking defence that only does the first half
  leaves the app itself as a frame host.
- **`worker-src 'self'` spelled out** rather than left to fall back to
  `script-src`, which carries `'strict-dynamic'` — a source expression with no
  defined meaning for a worker.
- **`img-src 'self' data:` and not `blob:`.** Nothing renders an object URL, and
  `blob:` in `img-src` is a documented way to turn an XSS into an exfiltration
  channel.
- **No `style-src-attr`.** React sets the `style` prop through the CSSOM
  (`element.style.setProperty`), which CSP does not govern at all. Style
  attributes only matter when they arrive as markup, and `docs/xss.md` is why
  no markup arrives as a string here.
- **`form-action 'self'` is enough for OAuth.** The hand-off to Google is a
  `location.assign()`, which is a top-level navigation rather than a form
  submission; `navigate-to` was dropped from CSP3 and no browser ships it.
- **`X-XSS-Protection` was removed.** It is unimplemented in every current
  browser and was a known same-site information leak in the ones that had it. A
  real CSP replaces it.

## Two things in `nginx.conf` that are about CSP by accident

**`Cache-Control` moved into a `map`.** `add_header` directives are inherited
from the enclosing level _only if no `add_header` appears at the current level_.
`location ~* \.(js|css|…)$` declared a Cache-Control header and thereby dropped
every security header the server block sets — so the files that are 99% of this
application's bytes were served with no `X-Content-Type-Options`, no
`Referrer-Policy` and would have had no CSP. The map keeps the per-URI decision
and leaves exactly one `add_header` list, at server level, where the
inheritance rule has nothing to take away. `tooling/csp/nginxConfig.test.ts`
fails if an `add_header` reappears inside a `location`.

**Dot-paths are denied.** `dist/.vite/manifest.json` was publicly fetchable, and
`dist/.csp/policy.conf` would have joined it — which is how a change whose
subject is the security posture publishes the security posture.
`location ~ /\. { deny all; }` covers both, and the plugin installs the same
rule on `vite preview`, because a local server more permissive than the
deployed one is a local server that cannot test this. `vite preview` answered
both with a 200 until it did; `e2e/csp.spec.ts` is what asked.

**Not on the dev server**, which is the second thing a test found. A dev
server's URL space is not a directory listing: Vite serves every pre-bundled
dependency from `/node_modules/.vite/deps/`, so the same rule returned 403 for
React and every page went blank. Nothing is lost — the dot-directories exist
only in a build output, and Vite's `server.fs.deny` already covers `.env` and
key material.

If this app ever needs `/.well-known/`, that needs its own
`location ^~ /.well-known/` above the nginx deny rule.

## What is not done

- **Nothing in CI runs nginx.** `tooling/csp/nginxConfig.test.ts` pins the names
  the build and the server must agree on, and the decisions the policy depends
  on being true of the server, but it is a text match. The configuration in this
  repository was verified by hand against nginx 1.24 — per-request nonce in the
  header and the document, assets carrying every security header, dot-paths
  403, SPA fallback intact — and nothing re-verifies it on each change. A
  `nginx -t` job plus a container smoke test is the obvious next item.
- **No `report-to` endpoint.** The in-page reporter is a DOM listener, so it
  structurally cannot hear a violation that happened before it was attached —
  including a refused entry script, which is what a failed nonce substitution
  looks like. `e2e/csp.spec.ts` covers that case by subscribing before the
  page's own scripts; covering it in production needs a collector that speaks
  the CSP report format, which `VITE_ERROR_REPORT_URL` does not.
- **The Cloudflare Pages preview deploy has no CSP at all.** A nonce needs a
  server that runs per request, and Pages serves static files; `_headers` cannot
  interpolate anything. Doing it there means a Pages Function, and
  `dist/.csp/policy.txt` exists so that one would have a policy to read.
- **The policy is enforced, not report-only.** There is no staged rollout here
  because there is no traffic to stage against. Pointing a real deployment at
  this should start with `Content-Security-Policy-Report-Only` and a collector.
- **The service worker inherits no policy**, because `/sw.js` is served by the
  static-asset location. That is the right outcome rather than a gap — a nonce
  means nothing in a worker, and the worker's own fetches are same-origin or to
  the API origin `connect-src` already names — but it is worth knowing that the
  document's policy is not the worker's.
