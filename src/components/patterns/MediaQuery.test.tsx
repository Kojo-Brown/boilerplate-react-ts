import { useState, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { MediaQuery } from "@/components/patterns/MediaQuery";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { installMediaQueryHarness, type MediaQueryHarness } from "@/test/mediaQueryHarness";

const WIDE = "(min-width: 48rem)";

let media: MediaQueryHarness;

beforeEach(() => {
  media = installMediaQueryHarness();
});

afterEach(() => {
  media.restore();
});

describe("MediaQuery", () => {
  it("calls its children with the current match", () => {
    render(<MediaQuery query={WIDE}>{(matches) => <p>{String(matches)}</p>}</MediaQuery>);
    expect(screen.getByText("false")).toBeInTheDocument();

    media.setMatches(WIDE, true);
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("reports exactly what the hook reports", () => {
    /*
     * The claim the whole doc rests on: this component is a delivery
     * mechanism, not a second implementation. Two subscriptions to the same
     * query, one through each API, rendered side by side and flipped — if the
     * render prop ever grew logic of its own, this is where the two answers
     * would come apart.
     */
    function ViaHook() {
      const matches = useMediaQuery(WIDE);
      return <span data-testid="hook">{String(matches)}</span>;
    }

    render(
      <>
        <ViaHook />
        <MediaQuery query={WIDE}>
          {(matches) => <span data-testid="render-prop">{String(matches)}</span>}
        </MediaQuery>
      </>,
    );

    expect(screen.getByTestId("render-prop")).toHaveTextContent(
      screen.getByTestId("hook").textContent,
    );

    media.setMatches(WIDE, true);

    expect(screen.getByTestId("hook")).toHaveTextContent("true");
    expect(screen.getByTestId("render-prop")).toHaveTextContent("true");
  });

  it("subscribes once per mounted consumer, not once per render-prop call", () => {
    const { rerender } = render(
      <MediaQuery query={WIDE}>{(matches) => <p>{String(matches)}</p>}</MediaQuery>,
    );
    rerender(<MediaQuery query={WIDE}>{(matches) => <p>{String(matches)}</p>}</MediaQuery>);

    expect(media.addEventListener).toHaveBeenCalledTimes(1);
  });

  it("lets its children hold state, because the call is unconditional", () => {
    // Hooks called inside a render prop attach to the *provider's* fiber —
    // the function runs during `MediaQuery`'s render, not the caller's. That
    // is legal and stable here for one reason only: `MediaQuery` always calls
    // `children`, so the hook count never changes. The next test is what
    // happens when a render-prop component does not.
    render(
      <MediaQuery query={WIDE}>
        {(matches) => {
          // The rule does not fire here — it only recognises a hook call in a
          // function it can see is a callback, and this one is an inline JSX
          // child. That blind spot is the point: whether this is legal depends
          // on how `MediaQuery` invokes it, which is a fact about another file.
          const [clicks, setClicks] = useState(0);
          return (
            <button
              type="button"
              onClick={() => {
                setClicks((n) => n + 1);
              }}
            >
              {String(matches)}:{clicks}
            </button>
          );
        }}
      </MediaQuery>,
    );

    expect(screen.getByRole("button", { name: "false:0" })).toBeInTheDocument();

    media.setMatches(WIDE, true);

    // The state survived a re-render driven by the provider's own subscription.
    expect(screen.getByRole("button", { name: "true:0" })).toBeInTheDocument();
  });
});

describe("hooks inside a conditionally-invoked render prop", () => {
  let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  /**
   * A render-prop component that calls its children only sometimes — the
   * shape half the render-prop components in circulation have, and the reason
   * `MediaQuery` above is careful not to.
   */
  function OnlyWhenMatching({
    query,
    children,
  }: {
    query: string;
    children: (matches: boolean) => ReactNode;
  }) {
    const matches = useMediaQuery(query);
    return <>{matches ? children(matches) : null}</>;
  }

  it("breaks React's hook ordering in a component the caller did not write", () => {
    /*
     * The trap this pattern carries and a hook does not.
     *
     * The caller's function is invoked during `OnlyWhenMatching`'s render, so
     * `useState` below is `OnlyWhenMatching`'s hook — the caller has reached
     * into a component it does not own and added one. While the query does
     * not match, the function is not called and the hook does not exist; when
     * it starts matching, the hook count goes from one to two and React
     * throws.
     *
     * Nothing on the caller's side looks wrong, the error names a component
     * from somewhere else, and no lint rule can see it: `children` is an
     * ordinary function argument, and whether it is called conditionally is a
     * fact about the *other* file. The equivalent hook — `useMediaQuery` at
     * the top of a real component — cannot be written this way at all.
     */
    function Caller() {
      return (
        <OnlyWhenMatching query={WIDE}>
          {(matches) => {
            // eslint-disable-next-line react-hooks/rules-of-hooks -- deliberate: the illegal call is the subject of the test.
            const [label] = useState("wide");
            return (
              <p>
                {label}:{String(matches)}
              </p>
            );
          }}
        </OnlyWhenMatching>
      );
    }

    render(<Caller />);
    expect(screen.queryByText(/wide/)).not.toBeInTheDocument();

    expect(() => {
      media.setMatches(WIDE, true);
    }).toThrow(/Rendered more hooks than during the previous render/);
  });
});
