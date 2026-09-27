import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { createAnnouncer } from "@/shared/a11y/announcer";
import { LiveRegions } from "@/shared/a11y/LiveRegions";

const GAP_MS = 150;

describe("LiveRegions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders both pairs empty and correctly labelled from the first paint", () => {
    render(<LiveRegions announcer={createAnnouncer()} />);

    const polite = [screen.getByTestId("polite-0"), screen.getByTestId("polite-1")];
    const assertive = [screen.getByTestId("assertive-0"), screen.getByTestId("assertive-1")];

    for (const region of polite) {
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveAttribute("aria-atomic", "true");
      expect(region).toBeEmptyDOMElement();
    }
    for (const region of assertive) {
      expect(region).toHaveAttribute("aria-live", "assertive");
      expect(region).toHaveAttribute("aria-atomic", "true");
      expect(region).toBeEmptyDOMElement();
    }

    /*
     * No `role="status"` or `role="alert"`, which mean exactly these attribute
     * pairs and would change nothing for a reader. They would make four
     * permanently-mounted empty spans claim to be status messages, so anything
     * asking the document for its alerts — `getByRole("alert")` on the login
     * page, or a user listing the page's elements — would find them alongside
     * the real one.
     */
    for (const region of [...polite, ...assertive]) {
      expect(region).not.toHaveAttribute("role");
    }
  });

  it("writes an announcement into one region of the pair and leaves the other empty", () => {
    const announcer = createAnnouncer();
    render(<LiveRegions announcer={announcer} />);

    act(() => {
      announcer.announce("12 results");
    });

    expect(screen.getByTestId("polite-1")).toHaveTextContent("12 results");
    // Both halves holding the text would leave a stale copy in the
    // accessibility tree for anyone reading the page rather than listening.
    expect(screen.getByTestId("polite-0")).toBeEmptyDOMElement();
  });

  it("moves the next announcement to the other half of the pair", () => {
    const announcer = createAnnouncer();
    render(<LiveRegions announcer={announcer} />);

    act(() => {
      announcer.announce("first");
    });
    act(() => {
      announcer.announce("second");
      vi.advanceTimersByTime(GAP_MS);
    });

    expect(screen.getByTestId("polite-0")).toHaveTextContent("second");
    expect(screen.getByTestId("polite-1")).toBeEmptyDOMElement();
  });

  it("keeps an error out of the polite regions", () => {
    const announcer = createAnnouncer();
    render(<LiveRegions announcer={announcer} />);

    act(() => {
      announcer.announce("could not save", { politeness: "assertive" });
    });

    expect(screen.getByTestId("assertive-1")).toHaveTextContent("could not save");
    expect(screen.getByTestId("polite-0")).toBeEmptyDOMElement();
    expect(screen.getByTestId("polite-1")).toBeEmptyDOMElement();
  });

  it("speaks what was announced before it mounted", () => {
    const announcer = createAnnouncer();
    // Effects run child-first, so a component below this one that announces
    // from its own mount effect gets here first on the very first commit.
    announcer.announce("said before anything rendered");

    render(<LiveRegions announcer={announcer} />);

    expect(screen.getByTestId("polite-1")).toHaveTextContent("said before anything rendered");
  });

  it("does not subscribe two announcers to one region set", () => {
    const announcer = createAnnouncer();
    const other = createAnnouncer();
    render(<LiveRegions announcer={announcer} />);

    act(() => {
      other.announce("wrong announcer");
    });

    expect(screen.getByTestId("live-regions")).toHaveTextContent("");
  });
});
