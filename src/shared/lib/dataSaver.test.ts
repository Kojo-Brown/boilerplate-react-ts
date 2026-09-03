import { describe, it, expect } from "vitest";
import { prefersReducedData, readConnection } from "@/shared/lib/dataSaver";

/**
 * A `Navigator` with a chosen `connection`.
 *
 * Built rather than patched onto the global: `navigator.connection` is absent
 * in jsdom, and defining it globally would leak the preference into every
 * other test in the file through a property nothing resets.
 */
function navigatorWith(connection: unknown): Navigator {
  return { connection } as unknown as Navigator;
}

describe("prefersReducedData", () => {
  it("is false when the browser exposes no connection information", () => {
    // Firefox and Safari, i.e. most of the web. Answering "reduce" here would
    // disable prefetching in two engines out of three and look identical to
    // the feature being broken.
    expect(prefersReducedData(navigatorWith(undefined))).toBe(false);
    expect(readConnection(navigatorWith(undefined))).toBeNull();
  });

  it("is true when Save-Data is on", () => {
    expect(prefersReducedData(navigatorWith({ saveData: true }))).toBe(true);
  });

  it("is false when Save-Data is explicitly off", () => {
    expect(prefersReducedData(navigatorWith({ saveData: false }))).toBe(false);
  });

  it("is true on 2g and slow-2g", () => {
    expect(prefersReducedData(navigatorWith({ effectiveType: "2g" }))).toBe(true);
    expect(prefersReducedData(navigatorWith({ effectiveType: "slow-2g" }))).toBe(true);
  });

  it("is false on 3g and 4g", () => {
    // 3g is deliberately allowed: it is the modal connection in much of the
    // world, and it is where arriving with the chunk already fetched helps
    // most.
    expect(prefersReducedData(navigatorWith({ effectiveType: "3g" }))).toBe(false);
    expect(prefersReducedData(navigatorWith({ effectiveType: "4g" }))).toBe(false);
  });

  it("ignores values of the wrong type rather than treating them as a preference", () => {
    expect(prefersReducedData(navigatorWith({ saveData: "true", effectiveType: 2 }))).toBe(false);
    expect(prefersReducedData(navigatorWith(null))).toBe(false);
    expect(prefersReducedData(navigatorWith("2g"))).toBe(false);
  });

  it("defaults to the ambient navigator", () => {
    // jsdom has no `connection`, so the ambient answer is "no preference".
    expect(prefersReducedData()).toBe(false);
  });
});
