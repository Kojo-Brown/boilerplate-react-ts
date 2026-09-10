import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  installListenerProbe,
  readListenerProbeCensus,
  diffListenerCensus,
  LISTENER_PROBE_KEY,
  type ListenerCensus,
} from "./listenerProbe.ts";

/**
 * The probe patches `EventTarget.prototype` globally, so every test here has
 * to put it back. jsdom shares one prototype across the whole file: a test
 * that left the patch installed would have the *next* test's listeners counted
 * into its census, which is the same class of bug the probe exists to find.
 */
const holders: object[] = [EventTarget.prototype, globalThis, Document.prototype].filter((holder) =>
  Object.prototype.hasOwnProperty.call(holder, "addEventListener"),
);
const natives = holders.map((holder) => ({
  holder: holder as Pick<EventTarget, "addEventListener" | "removeEventListener">,
  add: (holder as EventTarget).addEventListener,
  remove: (holder as EventTarget).removeEventListener,
}));

beforeEach(() => {
  installListenerProbe();
});

afterEach(() => {
  for (const native of natives) {
    native.holder.addEventListener = native.add;
    native.holder.removeEventListener = native.remove;
  }
  Reflect.deleteProperty(globalThis, LISTENER_PROBE_KEY);
});

function censusFor(target: string, type: string): number {
  return readListenerProbeCensus()
    .entries.filter((entry) => entry.target === target && entry.type === type)
    .reduce((total, entry) => total + entry.count, 0);
}

describe("installListenerProbe", () => {
  it("counts a registration and forgets it on removal", () => {
    const listener = (): void => undefined;
    window.addEventListener("resize", listener);
    expect(censusFor("window", "resize")).toBe(1);

    window.removeEventListener("resize", listener);
    expect(censusFor("window", "resize")).toBe(0);
  });

  it("still delivers the event it is counting", () => {
    let calls = 0;
    const listener = (): void => {
      calls += 1;
    };
    window.addEventListener("ping", listener);
    window.dispatchEvent(new Event("ping"));
    window.removeEventListener("ping", listener);

    expect(calls).toBe(1);
  });

  it("counts a duplicate registration once, as the DOM does", () => {
    const listener = (): void => undefined;
    window.addEventListener("scroll", listener);
    window.addEventListener("scroll", listener);

    expect(censusFor("window", "scroll")).toBe(1);

    // And one removal is enough to clear it, matching the DOM again.
    window.removeEventListener("scroll", listener);
    expect(censusFor("window", "scroll")).toBe(0);
  });

  it("treats capture and bubble registrations as distinct", () => {
    const listener = (): void => undefined;
    window.addEventListener("click", listener);
    window.addEventListener("click", listener, true);
    expect(censusFor("window", "click")).toBe(2);

    // Removing without the capture flag removes only the bubble one — the
    // asymmetry that makes half-cleaned-up teardowns so easy to write.
    window.removeEventListener("click", listener);
    expect(censusFor("window", "click")).toBe(1);

    window.removeEventListener("click", listener, true);
    expect(censusFor("window", "click")).toBe(0);
  });

  it("ignores `once` listeners, which remove themselves without telling us", () => {
    const listener = (): void => undefined;
    window.addEventListener("load", listener, { once: true });

    expect(censusFor("window", "load")).toBe(0);
  });

  it("counts a `handleEvent` object listener", () => {
    const listener = { handleEvent: (): void => undefined };
    window.addEventListener("message", listener);
    expect(censusFor("window", "message")).toBe(1);

    window.removeEventListener("message", listener);
    expect(censusFor("window", "message")).toBe(0);
  });

  it("flags a listener left on a node that is out of the document", () => {
    const node = document.createElement("div");
    node.id = "leaky";
    document.body.append(node);
    node.addEventListener("click", () => undefined);

    expect(readListenerProbeCensus().detachedTotal).toBe(0);

    node.remove();

    const census = readListenerProbeCensus();
    expect(census.detachedTotal).toBe(1);
    expect(census.entries).toContainEqual({
      target: "div#leaky",
      type: "click",
      count: 1,
      detached: true,
    });
  });

  it("describes an element by tag, id and classes", () => {
    const node = document.createElement("button");
    node.className = "btn primary";
    document.body.append(node);
    node.addEventListener("click", () => undefined);

    expect(readListenerProbeCensus().entries[0]?.target).toBe("button.btn.primary");
    node.remove();
  });

  it("is idempotent, so a second install cannot double-count", () => {
    const listener = (): void => undefined;
    installListenerProbe();
    window.addEventListener("resize", listener);

    expect(censusFor("window", "resize")).toBe(1);
    window.removeEventListener("resize", listener);
  });

  it("does not itself retain the targets it counts", () => {
    // The registry holds `WeakRef`s; what is asserted here is the observable
    // consequence — a target with no live registrations is dropped from the
    // census rather than accumulating an entry with a count of zero.
    const node = document.createElement("div");
    const listener = (): void => undefined;
    node.addEventListener("click", listener);
    node.removeEventListener("click", listener);

    expect(readListenerProbeCensus().entries).toHaveLength(0);
    expect(readListenerProbeCensus().total).toBe(0);
  });
});

describe("readListenerProbeCensus", () => {
  it("throws when the probe was never installed, rather than reporting zero", () => {
    Reflect.deleteProperty(globalThis, LISTENER_PROBE_KEY);

    expect(() => readListenerProbeCensus()).toThrow(/not installed/);
  });
});

describe("diffListenerCensus", () => {
  const census = (entries: ListenerCensus["entries"]): ListenerCensus => ({
    entries,
    total: entries.reduce((sum, entry) => sum + entry.count, 0),
    detachedTotal: entries
      .filter((entry) => entry.detached)
      .reduce((sum, entry) => sum + entry.count, 0),
  });

  it("reports growth, shrinkage and appearances, biggest growth first", () => {
    const before = census([
      { target: "window", type: "resize", count: 1, detached: false },
      { target: "window", type: "scroll", count: 3, detached: false },
      { target: "document", type: "keydown", count: 2, detached: false },
    ]);
    const after = census([
      { target: "window", type: "resize", count: 5, detached: false },
      { target: "window", type: "scroll", count: 1, detached: false },
      { target: "document", type: "keydown", count: 2, detached: false },
      { target: "div#modal", type: "click", count: 2, detached: true },
    ]);

    expect(diffListenerCensus(before, after)).toEqual([
      { target: "window", type: "resize", before: 1, after: 5, growth: 4, detached: false },
      { target: "div#modal", type: "click", before: 0, after: 2, growth: 2, detached: true },
      { target: "window", type: "scroll", before: 3, after: 1, growth: -2, detached: false },
    ]);
  });

  it("folds the several rows one target can produce into a single pair", () => {
    // The census emits one row per (target, type); two different elements can
    // describe identically (`div#root`), and a diff that did not fold them
    // would report a phantom growth for whichever row happened to sort first.
    const before = census([
      { target: "div#root", type: "click", count: 1, detached: false },
      { target: "div#root", type: "click", count: 1, detached: false },
    ]);
    const after = census([{ target: "div#root", type: "click", count: 2, detached: false }]);

    expect(diffListenerCensus(before, after)).toEqual([]);
  });

  it("says nothing about pairs that did not move", () => {
    const same = census([{ target: "window", type: "resize", count: 2, detached: false }]);

    expect(diffListenerCensus(same, same)).toEqual([]);
  });
});
