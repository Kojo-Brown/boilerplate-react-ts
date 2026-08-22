import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RenderPropsLabPage } from "@/pages/RenderPropsLabPage";
import { installMediaQueryHarness, type MediaQueryHarness } from "@/test/mediaQueryHarness";

const FIRST_QUERY = "(min-width: 48rem)";
const SECOND_QUERY = "(min-width: 64rem)";

let media: MediaQueryHarness;

beforeEach(() => {
  media = installMediaQueryHarness();
});

afterEach(() => {
  media.restore();
});

function cardValues() {
  return {
    hook: screen.getByTestId("card-hook").dataset["matches"],
    renderProp: screen.getByTestId("card-render-prop").dataset["matches"],
    hoc: screen.getByTestId("card-hoc").dataset["matches"],
  };
}

describe("RenderPropsLabPage", () => {
  it("renders the three deliveries in agreement", () => {
    render(<RenderPropsLabPage />);
    expect(cardValues()).toEqual({ hook: "false", renderProp: "false", hoc: "false" });

    media.setMatches(FIRST_QUERY, true);

    // The point of the exhibit: one implementation, so they cannot disagree.
    expect(cardValues()).toEqual({ hook: "true", renderProp: "true", hoc: "true" });
  });

  it("moves all three subscriptions when the query changes", async () => {
    const user = userEvent.setup();
    media.setMatches(SECOND_QUERY, true);

    render(<RenderPropsLabPage />);
    expect(cardValues()).toEqual({ hook: "false", renderProp: "false", hoc: "false" });

    await user.click(screen.getByRole("button", { name: "≥ 64rem" }));

    expect(screen.getByTestId("chosen-query")).toHaveTextContent(SECOND_QUERY);
    expect(cardValues()).toEqual({ hook: "true", renderProp: "true", hoc: "true" });
  });

  it("keeps the module-scope wrapper's state across a parent re-render and loses the other", async () => {
    /*
     * The whole reason the second half of the page exists. Both counters are
     * the same component behind the same HOC; only the placement of the
     * `withMediaQuery` call differs, and that decides whether React updates
     * the fiber or throws it away and mounts a new one.
     */
    const user = userEvent.setup();
    render(<RenderPropsLabPage />);

    await user.click(screen.getByTestId("count-module-scope"));
    await user.click(screen.getByTestId("count-module-scope"));
    await user.click(screen.getByTestId("count-created-in-render"));

    expect(screen.getByTestId("count-module-scope")).toHaveTextContent("clicked 2×");
    expect(screen.getByTestId("count-created-in-render")).toHaveTextContent("clicked 1×");

    await user.click(screen.getByTestId("rerender-parent"));

    expect(screen.getByTestId("count-module-scope")).toHaveTextContent("clicked 2×");
    expect(screen.getByTestId("count-created-in-render")).toHaveTextContent("clicked 0×");
  });
});
