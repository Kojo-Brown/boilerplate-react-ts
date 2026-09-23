import { describe, it, expect, afterEach } from "vitest";
import { getTabbableElements, nextTabStop, FOCUSABLE_SELECTOR } from "@/shared/lib/focusTrap";

function mount(html: string): HTMLElement {
  const container = document.createElement("div");
  container.tabIndex = -1;
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FOCUSABLE_SELECTOR", () => {
  it("matches a bare tabindex so negative values can be filtered rather than missed", () => {
    const container = mount(`<div tabindex="-1" id="skipped"></div>`);
    expect(container.querySelector(FOCUSABLE_SELECTOR)?.id).toBe("skipped");
    expect(getTabbableElements(container)).toEqual([]);
  });
});

describe("getTabbableElements", () => {
  it("returns focusable elements in document order", () => {
    const container = mount(`
      <a href="/one">one</a>
      <button>two</button>
      <input />
      <select></select>
      <textarea></textarea>
    `);
    expect(getTabbableElements(container).map((el) => el.tagName)).toEqual([
      "A",
      "BUTTON",
      "INPUT",
      "SELECT",
      "TEXTAREA",
    ]);
  });

  it("excludes an anchor with no href, which is not focusable", () => {
    const container = mount(`<a>no href</a><button>real</button>`);
    expect(getTabbableElements(container).map((el) => el.tagName)).toEqual(["BUTTON"]);
  });

  it("excludes disabled controls", () => {
    const container = mount(`<button disabled>no</button><button>yes</button>`);
    expect(getTabbableElements(container)).toHaveLength(1);
  });

  it("excludes controls inside a disabled fieldset", () => {
    const container = mount(`<fieldset disabled><button>no</button></fieldset>`);
    expect(getTabbableElements(container)).toEqual([]);
  });

  it("treats aria-disabled as still focusable, because it is", () => {
    const container = mount(`<button aria-disabled="true">still reachable</button>`);
    expect(getTabbableElements(container)).toHaveLength(1);
  });

  it("excludes elements hidden by display or visibility", () => {
    const container = mount(`
      <button style="display: none">no</button>
      <button style="visibility: hidden">no</button>
      <button>yes</button>
    `);
    expect(getTabbableElements(container)).toHaveLength(1);
  });

  it("excludes a subtree hidden by an ancestor's hidden attribute", () => {
    const container = mount(`<div hidden><button>no</button></div><button>yes</button>`);
    expect(getTabbableElements(container).map((el) => el.textContent)).toEqual(["yes"]);
  });

  it("excludes a subtree an ancestor marked inert", () => {
    // The drawer case: the links are unremarkable, the `<aside>` above them is
    // what takes them out of the tab order.
    const container = mount(`<aside inert><a href="/a">no</a></aside><button>yes</button>`);
    expect(getTabbableElements(container).map((el) => el.textContent)).toEqual(["yes"]);
  });

  it("keeps a positive tabindex, in document order rather than its declared order", () => {
    // Dropping it would make the trap unable to reach it and, through the
    // focusin guard, actively push focus off it.
    const container = mount(`<button>first</button><button tabindex="3">reordered</button>`);
    expect(getTabbableElements(container).map((el) => el.textContent)).toEqual([
      "first",
      "reordered",
    ]);
  });

  it("never includes the container itself even when it is focusable", () => {
    const container = mount(`<button>only</button>`);
    expect(getTabbableElements(container)).not.toContain(container);
  });
});

describe("nextTabStop", () => {
  const html = `<button id="first">first</button><button id="mid">mid</button><button id="last">last</button>`;

  it("wraps forward from the last element to the first", () => {
    const container = mount(html);
    const stop = nextTabStop(container, container.querySelector("#last"), false);
    expect(stop?.element.id).toBe("first");
    expect(stop?.preventDefault).toBe(true);
  });

  it("wraps backward from the first element to the last", () => {
    const container = mount(html);
    expect(nextTabStop(container, container.querySelector("#first"), true)?.element.id).toBe(
      "last",
    );
  });

  it("leaves the browser alone in the middle of the trap", () => {
    const container = mount(html);
    expect(nextTabStop(container, container.querySelector("#mid"), false)).toBeNull();
    expect(nextTabStop(container, container.querySelector("#mid"), true)).toBeNull();
  });

  it("pulls focus in from outside, to the end Tab was heading for", () => {
    const container = mount(html);
    const outside = document.createElement("button");
    document.body.append(outside);
    expect(nextTabStop(container, outside, false)?.element.id).toBe("first");
    expect(nextTabStop(container, outside, true)?.element.id).toBe("last");
  });

  it("treats no active element as outside", () => {
    const container = mount(html);
    expect(nextTabStop(container, null, false)?.element.id).toBe("first");
  });

  it("moves focus off the container itself onto a real tab stop", () => {
    // `contains` is true for the container, so this needs its own arm — the
    // state a freshly opened empty-then-filled trap is left in.
    const container = mount(html);
    expect(nextTabStop(container, container, false)?.element.id).toBe("first");
    expect(nextTabStop(container, container, true)?.element.id).toBe("last");
  });

  it("falls back to the container when nothing inside is tabbable", () => {
    const container = mount(`<button disabled>no</button>`);
    const stop = nextTabStop(container, document.body, false);
    expect(stop?.element).toBe(container);
  });

  it("does nothing when an empty trap already holds focus", () => {
    // Otherwise every Tab press would re-focus the container, which reads to a
    // screen reader as the dialog announcing itself again on every keystroke.
    const container = mount(`<button disabled>no</button>`);
    expect(nextTabStop(container, container, false)).toBeNull();
  });
});
