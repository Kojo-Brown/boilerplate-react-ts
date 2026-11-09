import { describe, it, expect } from "vitest";
import { REDACTED, isSensitiveKey, redactMessage, redactUrl } from "@/shared/observability/redact";

describe("isSensitiveKey", () => {
  it.each([
    "token",
    "access_token",
    "refreshToken",
    "ID_TOKEN",
    "csrf-token",
    "api_key",
    "clientSecret",
    "password",
    "authorization",
    "sessionId",
    "signature",
  ])("treats %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["page", "sort", "q", "locale", "tab"])("leaves %s alone", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  it("accepts a caller's own pattern list", () => {
    expect(isSensitiveKey("ssn", ["ssn"])).toBe(true);
    expect(isSensitiveKey("token", ["ssn"])).toBe(false);
  });
});

describe("REDACTED", () => {
  it("is the literal placeholder a reviewer reads in the error backend", () => {
    // Asserted as a literal rather than through the constant, because every
    // other test in this file compares against `REDACTED` on both sides and so
    // passes for any value at all — including `""`, which would quietly turn a
    // redacted parameter into an empty one that reads like missing data.
    expect(REDACTED).toBe("[redacted]");
  });
});

describe("redactUrl", () => {
  it("redacts the OAuth authorization code the callback route receives", () => {
    expect(redactUrl("/auth/callback?code=4%2F0AX4&state=xyz")).toBe(
      `/auth/callback?code=${encodeURIComponent(REDACTED)}&state=xyz`,
    );
  });

  it("keeps harmless parameters readable", () => {
    expect(redactUrl("/posts?page=2&sort=new")).toBe("/posts?page=2&sort=new");
  });

  it("drops the fragment entirely, where the implicit flow returns its token", () => {
    expect(redactUrl("/callback#access_token=secret&token_type=bearer")).toBe("/callback");
  });

  it("preserves an absolute URL's origin", () => {
    expect(redactUrl("https://api.example.com/me?api_key=abc&page=1")).toBe(
      `https://api.example.com/me?api_key=${encodeURIComponent(REDACTED)}&page=1`,
    );
  });

  it("leaves a URL with no query or fragment untouched", () => {
    expect(redactUrl("/dashboard")).toBe("/dashboard");
  });

  /*
   * Parsing a relative URL needs a base, and the base must not survive into
   * the output. Both halves of the relative/absolute test below were
   * unasserted: a reporter that leaks `http://redact.invalid` into every
   * breadcrumb is reporting a hostname that does not exist.
   */
  it("strips the placeholder base from a URL that arrived carrying it", () => {
    expect(redactUrl("http://redact.invalid/x?token=a")).toBe(
      `/x?token=${encodeURIComponent(REDACTED)}`,
    );
  });

  it("keeps a relative URL relative even when a colon appears inside it", () => {
    // The scheme test is anchored for this reason. Unanchored, the `re:` in
    // this query value reads as a scheme, the URL is classified absolute, and
    // the placeholder origin is handed to the error backend as if it were real.
    expect(redactUrl("/notes?title=re:draft&token=abc")).toBe(
      `/notes?title=re%3Adraft&token=${encodeURIComponent(REDACTED)}`,
    );
  });

  /*
   * The unparseable branch, asserted on exact output rather than on
   * `not.toContain("secret")`.
   *
   * A lone "%" is an invalid escape, so the URL parser rejects it outright —
   * and an unparseable URL is exactly the case where nothing can be said about
   * what is inside it, so everything from the first delimiter onwards goes.
   * "Does not contain the secret" was true of almost every way of getting this
   * branch wrong, including returning the empty string and cutting at offset 0;
   * the four cases below pin where the cut lands instead.
   */
  describe("a URL that will not parse", () => {
    it("cuts at the query string", () => {
      expect(redactUrl("http://%/x?token=secret")).toBe(`http://%/x?${REDACTED}`);
    });

    it("cuts at the fragment when there is no query", () => {
      expect(redactUrl("http://%/x#access_token=secret")).toBe(`http://%/x?${REDACTED}`);
    });

    it("cuts at whichever delimiter comes first, not whichever was searched for first", () => {
      // `#` before `?`, which is what orders the two offsets rather than
      // taking the query's. Cutting at the later one would hand the fragment
      // back — and the implicit OAuth flow puts its access token there.
      expect(redactUrl("http://%/x#frag?token=secret")).toBe(`http://%/x?${REDACTED}`);
    });

    it("is returned whole when it carries neither a query nor a fragment", () => {
      // Nothing to redact, so nothing is appended: an unparseable path is not
      // made to look like it had a query string.
      expect(redactUrl("http://%/x")).toBe("http://%/x");
    });
  });
});

describe("redactMessage", () => {
  it("redacts a URL quoted inside a network error message", () => {
    const message = "Failed to fetch https://api.example.com/me?access_token=sk-live-1234";
    expect(redactMessage(message)).toBe(
      `Failed to fetch https://api.example.com/me?access_token=${encodeURIComponent(REDACTED)}`,
    );
  });

  it("hands back the sentence punctuation that followed the URL", () => {
    expect(redactMessage("Could not reach https://x.test/a?token=abc.")).toBe(
      `Could not reach https://x.test/a?token=${encodeURIComponent(REDACTED)}.`,
    );
  });

  it("hands back a whole run of trailing punctuation, not just the last character", () => {
    // A URL in parentheses at the end of a sentence closes with `).`. Treating
    // only the final character as punctuation leaves the `)` inside the URL,
    // where it is parsed as part of the last query value.
    expect(redactMessage("Could not reach https://x.test/a?token=abc).")).toBe(
      `Could not reach https://x.test/a?token=${encodeURIComponent(REDACTED)}).`,
    );
  });

  it("does not swallow the punctuation into a URL whose parameters are all harmless", () => {
    /*
     * The case that makes the trailing-punctuation split observable at all.
     * When the URL ends in a sensitive value, handing the punctuation back and
     * redacting it away produce the same string, so the split can be wrong
     * without any test noticing. With `page=2` nothing is redacted, and a URL
     * that kept its own full stop comes back with two.
     */
    expect(redactMessage("Fetched https://x.test/a?page=2.")).toBe(
      "Fetched https://x.test/a?page=2.",
    );
  });

  it("leaves prose with no URL in it unchanged", () => {
    expect(redactMessage("Cannot read properties of undefined")).toBe(
      "Cannot read properties of undefined",
    );
  });

  it("redacts every URL in a message, not only the first", () => {
    const out = redactMessage("from https://a.test/?token=one to https://b.test/?token=two");
    expect(out).not.toContain("one");
    expect(out).not.toContain("two");
  });
});
