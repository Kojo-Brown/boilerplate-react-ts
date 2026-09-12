import { describe, it, expect } from "vitest";
import {
  DEFAULT_BREADCRUMB_LIMIT,
  clickBreadcrumb,
  createBreadcrumbBuffer,
  navigationBreadcrumb,
} from "@/shared/observability/breadcrumbs";

function counter(): () => number {
  let n = 0;
  return () => (n += 1);
}

describe("createBreadcrumbBuffer", () => {
  it("returns crumbs oldest first", () => {
    const buffer = createBreadcrumbBuffer({ now: counter() });
    buffer.add({ category: "ui.click", level: "info", message: "one" });
    buffer.add({ category: "ui.click", level: "info", message: "two" });
    expect(buffer.snapshot().map((c) => c.message)).toEqual(["one", "two"]);
  });

  it("evicts the oldest once full, and still reads oldest first after wrapping", () => {
    const buffer = createBreadcrumbBuffer({ limit: 3, now: counter() });
    for (const message of ["a", "b", "c", "d", "e"]) {
      buffer.add({ category: "ui.click", level: "info", message });
    }
    expect(buffer.size).toBe(3);
    expect(buffer.snapshot().map((c) => c.message)).toEqual(["c", "d", "e"]);
  });

  it("never grows past its limit, however long the session runs", () => {
    const buffer = createBreadcrumbBuffer({ limit: 10, now: counter() });
    for (let i = 0; i < 10_000; i += 1) {
      buffer.add({ category: "ui.click", level: "info", message: `click ${i}` });
    }
    expect(buffer.size).toBe(10);
    expect(buffer.snapshot()).toHaveLength(10);
  });

  it("treats a zero limit as one rather than dividing by it", () => {
    const buffer = createBreadcrumbBuffer({ limit: 0, now: counter() });
    buffer.add({ category: "ui.click", level: "info", message: "a" });
    buffer.add({ category: "ui.click", level: "info", message: "b" });
    expect(buffer.snapshot().map((c) => c.message)).toEqual(["b"]);
  });

  it("hands out a copy the caller cannot use to mutate the ring", () => {
    const buffer = createBreadcrumbBuffer({ now: counter() });
    buffer.add({ category: "ui.click", level: "info", message: "a" });
    buffer.snapshot().push({ timestamp: 0, category: "x", level: "info", message: "injected" });
    expect(buffer.snapshot()).toHaveLength(1);
  });

  it("stamps a timestamp, and lets the caller supply one", () => {
    const buffer = createBreadcrumbBuffer({ now: () => 1234 });
    buffer.add({ category: "http", level: "info", message: "a" });
    buffer.add({ category: "http", level: "info", message: "b", timestamp: 9 });
    expect(buffer.snapshot().map((c) => c.timestamp)).toEqual([1234, 9]);
  });

  it("clears", () => {
    const buffer = createBreadcrumbBuffer({ now: counter() });
    buffer.add({ category: "ui.click", level: "info", message: "a" });
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.snapshot()).toEqual([]);
  });

  it("redacts a credential quoted in a crumb's message", () => {
    const buffer = createBreadcrumbBuffer({ now: counter() });
    buffer.add({
      category: "http",
      level: "info",
      message: "GET https://api.test/me?access_token=sk-live-99",
    });
    expect(buffer.snapshot()[0]?.message).not.toContain("sk-live-99");
  });

  it("redacts crumb data as well as the message", () => {
    const buffer = createBreadcrumbBuffer({ now: counter() });
    buffer.add({
      category: "http",
      level: "info",
      message: "request",
      data: { url: "https://api.test/x?token=leaky", method: "GET" },
    });
    const crumb = buffer.snapshot()[0];
    expect(crumb?.data?.["url"]).not.toContain("leaky");
    expect(crumb?.data?.["method"]).toBe("GET");
  });

  it("defaults to a bounded limit", () => {
    const buffer = createBreadcrumbBuffer({ now: counter() });
    for (let i = 0; i < DEFAULT_BREADCRUMB_LIMIT + 5; i += 1) {
      buffer.add({ category: "ui.click", level: "info", message: `${i}` });
    }
    expect(buffer.size).toBe(DEFAULT_BREADCRUMB_LIMIT);
  });

  it("honours a caller's own sensitive-key list", () => {
    const buffer = createBreadcrumbBuffer({ now: counter(), sensitiveKeys: ["ssn"] });
    buffer.add({ category: "navigation", level: "info", message: "https://x.test/?ssn=111" });
    expect(buffer.snapshot()[0]?.message).not.toContain("111");
  });
});

describe("navigationBreadcrumb", () => {
  it("records both ends of the move, redacted", () => {
    const crumb = navigationBreadcrumb("/login", "/auth/callback?code=secret-code");
    expect(crumb.category).toBe("navigation");
    expect(crumb.message).not.toContain("secret-code");
    expect(crumb.data?.["from"]).toBe("/login");
  });
});

describe("clickBreadcrumb", () => {
  it("names the element by its text", () => {
    const button = document.createElement("button");
    button.textContent = "  Delete account  ";
    expect(clickBreadcrumb(button).message).toBe("button: Delete account");
  });

  it("prefers an aria-label over text", () => {
    const button = document.createElement("button");
    button.setAttribute("aria-label", "Close dialog");
    button.textContent = "×";
    expect(clickBreadcrumb(button).message).toBe("button: Close dialog");
  });

  it("falls back to title, then to the bare tag name", () => {
    const withTitle = document.createElement("a");
    withTitle.setAttribute("title", "Docs");
    expect(clickBreadcrumb(withTitle).message).toBe("a: Docs");

    expect(clickBreadcrumb(document.createElement("input")).message).toBe("input");
  });

  it("truncates a long label", () => {
    const button = document.createElement("button");
    button.textContent = "x".repeat(200);
    expect(clickBreadcrumb(button).message.length).toBeLessThan(80);
  });

  it("retains no reference to the node it described", () => {
    // The point of deriving the label at record time: a crumb that kept the
    // element would pin it, and its subtree, in a buffer built to outlive
    // both. See docs/memory-leaks.md.
    const button = document.createElement("button");
    button.textContent = "Save";
    const crumb = clickBreadcrumb(button);
    const values = Object.values(crumb as Record<string, unknown>);
    expect(values.some((value) => value instanceof Node)).toBe(false);
    expect(JSON.stringify(crumb)).toContain("Save");
  });
});
