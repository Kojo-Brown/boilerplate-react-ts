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

  it("strips the query of something that will not parse rather than passing it through", () => {
    // A lone "%" is an invalid escape, so the URL parser rejects it outright —
    // and an unparseable URL is exactly the case where nothing can be said
    // about what is inside it.
    const redacted = redactUrl("http://%/x?token=secret");
    expect(redacted).not.toContain("secret");
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
    expect(redactMessage("Could not reach https://x.test/a?token=abc.")).toMatch(/\.$/);
    expect(redactMessage("Could not reach https://x.test/a?token=abc.")).not.toContain("abc");
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
