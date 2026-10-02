// @vitest-environment node
//
// The one case that cannot be written in jsdom: a context with no `window` at
// all. It is a real context — a build-time script, a prerender, a test with
// this very comment at the top — and it is the one where a sanitiser that
// assumes a DOM either throws at import time or, worse, returns its input.
import { describe, it, expect } from "vitest";
import { sanitizeHtml, escapeHtml } from "@/shared/lib/sanitizeHtml";

describe("sanitizeHtml without a DOM", () => {
  it("imports without throwing", () => {
    // The assertion is that the line above ran. A module-scope
    // `createDOMPurify(window)` would have thrown before this test was reached,
    // which is why the instance is created lazily.
    expect(typeof sanitizeHtml).toBe("function");
  });

  it("escapes its input rather than returning it unchanged", () => {
    const dirty = `<img src=x onerror="alert(1)">`;
    expect(sanitizeHtml(dirty)).toBe(escapeHtml(dirty));
    expect(sanitizeHtml(dirty)).not.toContain("<img");
  });

  it("escapes safe markup too, because it cannot tell the difference", () => {
    // Deliberately not "safe HTML passes through": without a parser there is no
    // way to know it is safe, and guessing is the whole bug.
    expect(sanitizeHtml("<p>hello</p>")).toBe("&lt;p&gt;hello&lt;/p&gt;");
  });
});
