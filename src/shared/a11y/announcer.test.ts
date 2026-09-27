import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { announce, announcer as appAnnouncer, createAnnouncer } from "@/shared/a11y/announcer";
import { createAnnouncerHarness } from "@/test/announcer";

const GAP_MS = 10;

/** Lets the gap between two messages in a queue elapse. */
function passGap(): void {
  vi.advanceTimersByTime(GAP_MS);
}

function harness(options: { maxQueued?: number } = {}) {
  return createAnnouncerHarness({ gapMs: GAP_MS, ...options });
}

describe("createAnnouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    appAnnouncer.reset();
  });

  it("writes the first message immediately and the next only after the gap", () => {
    const { announcer, texts } = harness();

    announcer.announce("first");
    announcer.announce("second");

    // Both are queued, but only one is in a region: two writes in one tick are
    // one DOM mutation, and the first text would never exist at a moment
    // anything could observe it.
    expect(texts()).toEqual(["first"]);

    passGap();
    expect(texts()).toEqual(["first", "second"]);
  });

  it("alternates slots so the same message twice is announced twice", () => {
    const { announcer, spoken } = harness();

    announcer.announce("No suggestions");
    passGap();
    // Spoken, so no longer in the queue to be collapsed against.
    announcer.announce("No suggestions");
    passGap();

    expect(spoken).toEqual([
      { politeness: "polite", text: "No suggestions" },
      { politeness: "polite", text: "No suggestions" },
    ]);
    // The pair is what makes that possible: the second write went to the other
    // region, so it is a mutation rather than an unchanged text node.
    expect(announcer.getState().polite.slot).toBe(0);
  });

  it("collapses a duplicate that is still waiting to be spoken", () => {
    const { announcer, texts } = harness();

    announcer.announce("first");
    announcer.announce("second");
    announcer.announce("second");
    passGap();
    passGap();

    expect(texts()).toEqual(["first", "second"]);
  });

  it("keeps polite and assertive on independent queues", () => {
    const { announcer, spoken } = harness();

    announcer.announce("saved");
    announcer.announce("upload failed", { politeness: "assertive" });

    /*
     * Both in the first tick, which is the whole point: an assertive message
     * made to wait behind a polite one has been demoted to polite by plumbing.
     * They are separate regions, so two writes in one commit are two mutations.
     */
    expect(spoken).toEqual([
      { politeness: "polite", text: "saved" },
      { politeness: "assertive", text: "upload failed" },
    ]);
  });

  it("queues nothing into the document until something is listening", () => {
    const announcer = createAnnouncer({ gapMs: GAP_MS });

    announcer.announce("said before anything rendered");

    expect(announcer.getState().polite.text).toBe("");
    expect(vi.getTimerCount()).toBe(0);

    const seen: string[] = [];
    announcer.subscribe(() => {
      seen.push(announcer.getState().polite.text);
    });

    // Effects run child-first, so this ordering is the normal one on first
    // paint, not an edge case.
    expect(seen).toEqual(["said before anything rendered"]);
  });

  it("ignores a blank message rather than clearing the region", () => {
    const { announcer, texts } = harness();

    announcer.announce("12 results");
    passGap();
    announcer.announce("   ");

    expect(texts()).toEqual(["12 results"]);
    expect(announcer.getState().polite.text).toBe("12 results");
  });

  it("trims what it is given", () => {
    const { announcer, texts } = harness();
    announcer.announce("  12 results\n");
    expect(texts()).toEqual(["12 results"]);
  });

  it("drops the oldest when a burst overflows the queue", () => {
    const { announcer, texts } = harness({ maxQueued: 2 });

    announcer.announce("one");
    announcer.announce("two");
    announcer.announce("three");
    announcer.announce("four");
    passGap();
    passGap();
    passGap();

    // "one" was spoken before the cap could apply to it; "two" is what the cap
    // dropped, because the newest messages are the truest description of where
    // things now stand.
    expect(texts()).toEqual(["one", "three", "four"]);
  });

  it("cancel withdraws an owner's unspoken messages and leaves everyone else's", () => {
    const owner = {};
    const { announcer, texts } = harness();

    announcer.announce("spoken already", { owner });
    announcer.announce("mine, still queued", { owner });
    announcer.announce("someone else's", {});
    announcer.cancel(owner);
    passGap();
    passGap();

    expect(texts()).toEqual(["spoken already", "someone else's"]);
  });

  it("cancel(undefined) retracts nothing", () => {
    const { announcer, texts } = harness();

    announcer.announce("first");
    announcer.announce("unowned");
    announcer.cancel(undefined);
    passGap();

    expect(texts()).toEqual(["first", "unowned"]);
  });

  it("reset clears queues, timers and regions", () => {
    const { announcer, texts } = harness();

    announcer.announce("first");
    announcer.announce("second");
    announcer.reset();

    expect(announcer.getState()).toEqual({
      polite: { slot: 0, text: "" },
      assertive: { slot: 0, text: "" },
    });
    expect(vi.getTimerCount()).toBe(0);

    passGap();
    expect(texts()).toEqual(["first"]);
  });

  it("stops notifying a listener that has unsubscribed", () => {
    const { announcer, stop, texts } = harness();

    announcer.announce("heard");
    passGap();
    stop();
    announcer.announce("not heard");
    passGap();

    expect(texts()).toEqual(["heard"]);
  });

  it("announce() writes to the application's announcer", () => {
    const seen: string[] = [];
    const stop = appAnnouncer.subscribe(() => {
      seen.push(appAnnouncer.getState().assertive.text);
    });

    announce("something broke", { politeness: "assertive" });
    stop();

    expect(seen).toEqual(["something broke"]);
  });
});
