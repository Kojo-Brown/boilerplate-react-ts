// @vitest-environment node
//
// String assertions about a header. There is no DOM in sight.
import { describe, it, expect } from "vitest";
import {
  REFRESH_COOKIE_NAME,
  issueRefreshCookie,
  clearRefreshCookie,
} from "@/shared/mocks/handlers";

/**
 * The refresh cookie's attributes, pinned.
 *
 * These mocks are the reference implementation of the server's half of
 * `docs/token-storage.md`, which makes them the thing a backend engineer reads
 * to find out what to send — so an attribute silently going missing here
 * propagates to a real deployment. None of the other tests would notice:
 * `HttpOnly` makes no difference to MSW (its jar is a `localStorage` entry, not
 * a browser cookie store), and `SameSite` and `Path` are not enforced by it
 * either. Every attribute below is therefore untested by construction anywhere
 * else in the unit suite.
 *
 * The one attribute that is *supposed* to be absent is `Secure`, because these
 * mocks serve `http://localhost` and a browser drops a `Secure` cookie sent
 * over plaintext. That exemption is environment-dependent and the others are
 * not, which is the distinction this file exists to keep: an assertion that the
 * header lacks `Secure` is also an assertion that nobody has quietly extended
 * the same reasoning to `HttpOnly`.
 */
describe("the refresh cookie's attributes", () => {
  const header = issueRefreshCookie();

  it("carries the token under the documented name", () => {
    expect(header.startsWith(`${REFRESH_COOKIE_NAME}=`)).toBe(true);
  });

  it("is HttpOnly, which is the point of the whole design", () => {
    // Without this the cookie is readable from `document.cookie` and the
    // refresh token is no safer than it was in `localStorage`.
    expect(header).toContain("HttpOnly");
  });

  it("is SameSite=Strict, closing the CSRF hole a cookie credential opens", () => {
    expect(header).toContain("SameSite=Strict");
    // `Lax` would let a top-level cross-site navigation carry it. Nothing in
    // this flow is one — the refresh is always an XHR from our own origin — so
    // there is no behaviour to trade for the weaker setting.
    expect(header).not.toContain("SameSite=Lax");
    expect(header).not.toContain("SameSite=None");
  });

  it("is scoped to /auth, so data routes never see it", () => {
    expect(header).toContain("Path=/auth");
    // `Path=/` is the default and the easy mistake: it would attach the
    // credential to `/posts`, `/feed` and everything added later.
    expect(header).not.toMatch(/Path=\/(?:;|$)/);
  });

  it("is bounded by a Max-Age, so a stolen cookie is not valid forever", () => {
    const maxAge = /Max-Age=(\d+)/.exec(header)?.[1];
    expect(maxAge).toBeDefined();
    expect(Number(maxAge)).toBeGreaterThan(0);
  });

  it("omits Secure, and only because these mocks serve http://localhost", () => {
    /*
      Asserted rather than left implicit, so the reason stays attached to the
      omission. A browser silently drops a `Secure` cookie on a plaintext
      origin, so setting it here would break every mocked login with no error —
      and production must set it, which is why `docs/token-storage.md` carries
      the full header rather than pointing at this file.
    */
    expect(header).not.toContain("Secure");
  });

  it("names every attribute it sets, and no others", () => {
    // A whole-shape assertion, so an attribute *added* without thought fails
    // too. The alternative — one `toContain` per attribute — can only ever
    // catch removals.
    const attributes = header
      .split("; ")
      .slice(1)
      .map((part) => part.split("=")[0]);
    expect(attributes).toEqual(["HttpOnly", "SameSite", "Path", "Max-Age"]);
  });
});

describe("clearing the refresh cookie", () => {
  const header = clearRefreshCookie();

  it("expires it immediately", () => {
    expect(header).toContain("Max-Age=0");
    expect(header).toContain(`${REFRESH_COOKIE_NAME}=;`);
  });

  it("repeats Path and the flags, which is what makes the deletion land", () => {
    /*
      A browser matches a deletion against name + domain + path. A
      `Set-Cookie: refresh_token=; Max-Age=0` without `Path=/auth` targets a
      *different* cookie — one at `/` that was never set — and leaves the real
      one in the jar, so logout appears to work and the session is still
      renewable. This is the attribute most likely to be dropped as redundant
      and the one whose absence is hardest to notice.
    */
    expect(header).toContain("Path=/auth");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
  });
});
