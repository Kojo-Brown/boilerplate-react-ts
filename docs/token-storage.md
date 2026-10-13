# Token storage

The session lives in two places and neither of them is `localStorage`:

|                   |                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------- |
| **Access token**  | A JavaScript variable — the `auth` slice in Redux. Short-lived, lost on reload.     |
| **Refresh token** | An `HttpOnly` cookie set by the server. Long-lived, and unreadable from JavaScript. |

Nothing about the session is persisted by the client. There is no `auth.user`,
no `auth.expiresAt`, and no token under any key: `authSlice.test.ts` asserts the
whole of Web Storage is untouched, and `e2e/token-storage.spec.ts` greps a real
browser's storage by token _value_ so a regression under a new key name fails
too.

## Why

`localStorage` is readable by every script running on the origin. That makes it
fine for a theme preference and wrong for a credential, and the asymmetry is
about blast radius rather than about tokens being special:

- An access token in `localStorage` is a bad afternoon. It expires in fifteen
  minutes, so an attacker gets a short window.
- A **refresh** token in `localStorage` is the account. It is long-lived by
  definition — that is its whole job — so one line of injected JavaScript buys
  persistent access that survives the page, the tab, the browser session and
  the user's password change, and it does so silently.

So the refresh token goes somewhere script cannot reach. `HttpOnly` is that
place: the browser attaches the cookie to requests and refuses to expose it to
`document.cookie`. It is enforced by the browser, which is why the only honest
test of it is a browser test.

This does not make the application XSS-proof. An attacker who can run script can
still call the API as the user for as long as the page is open, and can still
read the in-memory access token. What it removes is _persistence_: they lose
access the moment the tab closes, instead of holding a renewable credential.
That, plus `docs/xss.md`'s ban on HTML sinks and `docs/csp.md`'s policy, is the
layering.

## What a reload now costs

This is the part worth understanding before changing any of it, because the
naive version of this change is worse than what it replaced.

With tokens in `localStorage`, a reload restored the session synchronously:
four `getItem` calls during store construction, before the first render. "Is
there a session?" had two answers and both were available immediately.

Without them, the only durable part of the session is a cookie the client cannot
read. So the question becomes a network request — `POST /auth/refresh`, with the
cookie attached — and for the length of that round trip there is a **third**
answer: _not yet known_.

```
reload
  │
  ├─ store: { token: null, status: "anonymous" }
  │
  ├─ restoreSession() dispatches sessionRestoreStarted()   ← synchronous
  │     store: { token: null, status: "restoring" }
  │
  ├─ first paint: ProtectedRoute renders <PageLoader />
  │
  └─ POST /auth/refresh
        ├─ 200 → setCredentials() → status: "authenticated" → route renders
        └─ 401 → logout()         → status: "anonymous"     → redirect to /login
```

`AuthStatus` is that third answer. Collapse it back into "no token" — redirect
whenever `token === null` — and **every signed-in user is thrown out of the
application on every reload**, a few hundred milliseconds before the session they
still have finishes being restored. They do not come back, either: the restore
completing does not un-navigate them from `/login`.

Two details hold this together, and both are easy to break by accident:

- **`restoring` is not the initial state.** It is entered only by
  `sessionRestoreStarted()`, dispatched by `restoreSession` itself. A store that
  nobody is restoring reads `anonymous`, so a cold visit to a protected URL
  still redirects on the first render rather than hanging on a spinner nothing
  will resolve.
- **`restoreSession` dispatches before its first `await`.** An `async` function
  body runs synchronously up to that point, which is what makes the status
  `restoring` by the time React renders — without `main.tsx` having to await a
  network round trip ahead of the first paint for the signed-out majority.

## The server's half

The client cannot implement any of this alone. The cookie is issued by the
server; `src/shared/mocks/handlers.ts` is the reference implementation and the
contract the tests hold it to.

```
Set-Cookie: refresh_token=<token>; HttpOnly; Secure; SameSite=Strict; Path=/auth; Max-Age=604800
```

| Attribute         | Why                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HttpOnly`        | The point. Script cannot read it.                                                                                                                                                             |
| `Secure`          | Never sent over plaintext HTTP. **Omitted in the mocks only** because browsers drop `Secure` cookies on `http://localhost`; production must set it.                                           |
| `SameSite=Strict` | Closes the CSRF hole a cookie-borne credential otherwise opens. `Strict` rather than `Lax` because nothing here is a top-level navigation — the refresh is always an XHR from our own origin. |
| `Path=/auth`      | Scoping. The cookie reaches `/auth/refresh` and `/auth/logout` and is withheld from `/posts`, `/feed` and everything else.                                                                    |
| `Max-Age`         | Bounds the damage from a stolen cookie.                                                                                                                                                       |

Three further obligations on the server:

1. **Do not return the refresh token in a response body.** `LoginResponse` has no
   `refreshToken` field, and that absence is the contract — a server that sent
   one would be handing back the credential this design hides.
2. **Rotate on use.** The mock answers every refresh with a new cookie. A refresh
   token accepted twice is one a thief can keep using alongside its owner.
3. **401 without the cookie.** The mock checks for it rather than answering
   unconditionally, which is what makes `credentials: "include"` testable: a
   handler that always returned a token would stay green if the client stopped
   sending the cookie.

## `credentials: "include"`, and why it is not on `baseApi`

The application and the API are different origins, so the browser omits cookies
unless the request asks for them. The requests that ask are exactly the ones
that need to:

```ts
// src/features/auth/authApi.ts
const WITH_REFRESH_COOKIE = { credentials: "include" } as const;
```

Setting it on the shared `fetchBaseQuery` would have been one line and would have
attached the refresh cookie to `/posts`, `/feed` and every endpoint added later
— sending a long-lived credential to routes with no use for it. `Path=/auth` means
the browser would withhold it anyway, so the two halves agree:
the client asks only where it is needed, and the cookie is scoped so that is the
only place it could go. `e2e/token-storage.spec.ts` asserts a data request
carries no refresh cookie.

Note that `credentials: "include"` has consequences for a real server that the
mocks do not exercise: a credentialed cross-origin response may not use a
wildcard `Access-Control-Allow-Origin` and must send
`Access-Control-Allow-Credentials: true`, or the browser discards the response
before the application sees it. Under MSW and under Playwright's `route.fulfill`
the response is injected below the point where CORS is applied, so neither
environment catches a server that gets this wrong.

## The pieces

|                                        |                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/entities/session/authSlice.ts`    | The access token, in memory. No `refreshToken` field — it is unrepresentable, not merely unused. |
| `src/features/auth/restoreSession.ts`  | The boot-time refresh that replaces reading storage.                                             |
| `src/features/auth/authApi.ts`         | `login` / `refresh` / `logout`, and the `credentials: "include"` that carries the cookie.        |
| `src/app/api/storeSession.ts`          | The `SessionPort` the API client uses to renew after a 401.                                      |
| `src/features/auth/ProtectedRoute.tsx` | Waits while `restoring`; redirects only once `anonymous`.                                        |
| `tooling/eslint/noTokenStorage.ts`     | The ban that keeps all of the above true.                                                        |

## The lint rule

`tokens/no-token-storage` is what stops this decaying. None of the above is
self-sustaining: `localStorage.setItem` is one line, it is the obvious fix for
"the user is signed out when I reload", and it type-checks, lints, renders and
passes every other test. The commit that undoes this will be a two-line diff
with a plausible message.

Two checks, because neither covers the other:

- **A credential-shaped key** in `localStorage` or `sessionStorage`, anywhere.
  Catches a token stashed from a module that otherwise has every right to use
  storage.
- **Any Web Storage access at all** inside `src/entities/session/` and
  `src/features/auth/`. Those modules hold the credential and have no
  legitimate use for storage. This is the check that would have caught the code
  this replaced, whose keys were member expressions
  (`AUTH_STORAGE_KEYS.ACCESS_TOKEN`) that a key-matching rule cannot read.

`localStorage` itself is **not** banned. The theme toggle, the locale
preference, the offline write queue and `useLocalStorage` all use it correctly,
for data whose disclosure costs nothing. A rule that reported those would carry
four exemptions on day one and be deleted within a week. The policy is not
"storage is dangerous", it is "credentials do not go in storage".

### The one exemption

`src/features/auth/oauth.ts` keeps the PKCE code verifier and the `state` nonce
in `sessionStorage`, and is named in the rule's `allow` list in
`eslint.config.ts`. It is the one value in the auth flow that _cannot_ live in
memory: it is created before the browser navigates to Google and read after
Google navigates back, and a full-page cross-origin round trip discards the
heap in between. RFC 8252's browser-app profile specifies session storage for
exactly this reason.

It is also a different kind of value — single-use, valid for the seconds between
two redirects, and worthless without the authorization code it is exchanged
alongside. `sessionStorage` rather than `localStorage` so it dies with the tab.

Widening that list is a change to the lint configuration, which a reviewer reads
as one. A `// eslint-disable-next-line` is a line in whichever diff happened to
need it.

## What is tested where

The split is not arbitrary — some of these properties are unprovable in jsdom.

| Property                                                  | Where                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| The slice persists nothing                                | `authSlice.test.ts`                                                  |
| Login, refresh and logout persist nothing                 | `authApi.test.tsx`                                                   |
| Auth requests send `credentials: "include"`               | `authApi.test.tsx`, `storeSession.test.ts`, `restoreSession.test.ts` |
| No refresh token in any request body                      | `silentRefresh.test.ts`, `restoreSession.test.ts`                    |
| The restore marks the store `restoring` synchronously     | `restoreSession.test.ts`                                             |
| `ProtectedRoute` waits, then renders or redirects         | `ProtectedRoute.test.tsx`                                            |
| The ban reports the regression                            | `tooling/eslint/noTokenStorage.test.ts`                              |
| **The refresh cookie is unreadable from JavaScript**      | `e2e/token-storage.spec.ts`                                          |
| **A real reload restores the session with empty storage** | `e2e/protected-route.spec.ts`                                        |

The last two are in a browser because they cannot be anywhere else. `HttpOnly` is
a browser guarantee; jsdom has no cookie jar of its own here, and MSW's stand-in
keeps its cookies **in `localStorage`**, where they are trivially readable. A
unit test asserting "the refresh token is not reachable" would be asserting a
fact about the mock.

That same MSW behaviour is why unit tests use `appStorageKeys()` from
`src/test/localStorage.ts` rather than `localStorage.length === 0`: MSW's
`__msw-cookie-store__` key appears in any suite whose handlers set a cookie, so
the helper excludes it and asserts on what the _application_ wrote.
