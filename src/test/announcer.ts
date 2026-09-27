import {
  createAnnouncer,
  type Announcer,
  type AnnouncerOptions,
  type Politeness,
} from "@/shared/a11y/announcer";

export interface SpokenAnnouncement {
  readonly politeness: Politeness;
  readonly text: string;
}

export interface AnnouncementRecorder {
  /** Every announcement written to a region, in order. */
  readonly spoken: readonly SpokenAnnouncement[];
  /** Just the texts, optionally for one politeness. */
  texts: (politeness?: Politeness) => string[];
  stop: () => void;
}

export interface AnnouncerHarness extends AnnouncementRecorder {
  /** Pass this to the component or hook under test. */
  readonly announcer: Announcer;
}

const BOTH: readonly Politeness[] = ["polite", "assertive"];

/**
 * An announcer with a subscriber attached, recording what reaches the regions.
 *
 * The subscriber is the point rather than a convenience: nothing drains until
 * something is listening (see `announcer.ts`), so a test that only calls
 * `announce` and reads `getState()` observes an empty region and concludes the
 * announcement was lost. This harness is what a mounted `<LiveRegions>` is.
 *
 * Timers are Vitest's business rather than something injected here: the gap
 * between two messages is a real delay in a real queue, and `vi.useFakeTimers()`
 * already lets a test say when it has passed.
 *
 * Announcements are detected by the *slot* changing, not the text, because the
 * alternating pair is exactly the mechanism that makes a repeat of the same
 * message a real announcement — a recorder keyed on text would drop the second
 * "No suggestions" and agree with the bug.
 */
export function createAnnouncerHarness(options: AnnouncerOptions = {}): AnnouncerHarness {
  const announcer = createAnnouncer(options);
  return { announcer, ...observeAnnouncements(announcer) };
}

/**
 * The same recorder, attached to an announcer the test did not create.
 *
 * For the components that reach the application's announcer by importing it
 * rather than being handed one — a low-level control should not take an
 * `announcer` prop it exists only for tests to pass.
 */
export function observeAnnouncements(announcer: Announcer): AnnouncementRecorder {
  const spoken: SpokenAnnouncement[] = [];
  const lastSlot: Record<Politeness, 0 | 1> = { polite: 0, assertive: 0 };

  const unsubscribe = announcer.subscribe(() => {
    const state = announcer.getState();
    for (const politeness of BOTH) {
      const region = state[politeness];
      if (region.slot === lastSlot[politeness]) continue;
      lastSlot[politeness] = region.slot;
      // An empty region is the idle state, never an announcement — `reset()`
      // moves a slot back to zero and must not read as something being said.
      if (region.text === "") continue;
      spoken.push({ politeness, text: region.text });
    }
  });

  return {
    spoken,
    texts: (politeness) =>
      spoken
        .filter((entry) => politeness === undefined || entry.politeness === politeness)
        .map((entry) => entry.text),
    stop: unsubscribe,
  };
}
