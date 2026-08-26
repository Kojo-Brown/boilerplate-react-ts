import { useState, type Ref } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withMediaQuery, type MediaQueryInjectedProps } from "@/shared/ui/patterns/withMediaQuery";
import { installMediaQueryHarness, type MediaQueryHarness } from "@/test/mediaQueryHarness";

const WIDE = "(min-width: 48rem)";

let media: MediaQueryHarness;

beforeEach(() => {
  media = installMediaQueryHarness();
});

afterEach(() => {
  media.restore();
});

interface CounterProps extends MediaQueryInjectedProps {
  label: string;
}

/** Holds state, so a remount is visible rather than merely suspected. */
function Counter({ matches, label }: CounterProps) {
  const [clicks, setClicks] = useState(0);
  return (
    <button
      type="button"
      onClick={() => {
        setClicks((n) => n + 1);
      }}
    >
      {label}:{String(matches)}:{clicks}
    </button>
  );
}

function Card({ matches }: MediaQueryInjectedProps) {
  return <p>{String(matches)}</p>;
}
Card.presets = ["compact", "full"] as const;

describe("withMediaQuery", () => {
  it("injects the current match and keeps it up to date", () => {
    const Wrapped = withMediaQuery(Counter, WIDE);
    render(<Wrapped label="a" />);

    expect(screen.getByRole("button", { name: "a:false:0" })).toBeInTheDocument();

    media.setMatches(WIDE, true);

    expect(screen.getByRole("button", { name: "a:true:0" })).toBeInTheDocument();
  });

  it("names the wrapper after the HOC and the component it wrapped", () => {
    const Wrapped = withMediaQuery(Counter, WIDE);
    expect(Wrapped.displayName).toBe("withMediaQuery(Counter)");
  });

  it("hoists the wrapped component's statics", () => {
    const Wrapped = withMediaQuery(Card, WIDE);
    // Typed, not just present: `HoistedStatics` carries `presets` through the
    // return type, which is what the `@ts-expect-error` block below pins.
    expect(Wrapped.presets).toEqual(["compact", "full"]);
  });

  it("wins the injected prop over one the caller smuggles in", () => {
    /*
     * The type forbids passing `matches` (see below), but types are not the
     * only route into a component: a `{...rest}` spread of values that came
     * from JSON, a JavaScript caller, a test. The spread order in the HOC
     * decides what happens then, and the two orders differ in which side
     * silently loses. Injecting last is the right choice — the HOC's whole
     * job is to own this prop, and a caller-supplied `matches` that quietly
     * replaced a live subscription would be a component that stops responding
     * to the viewport for no visible reason.
     */
    const Wrapped = withMediaQuery(Counter, WIDE);
    const smuggled = { label: "a", matches: true } as unknown as { label: string };

    render(<Wrapped {...smuggled} />);

    expect(screen.getByRole("button", { name: "a:false:0" })).toBeInTheDocument();
  });

  it("forwards a ref to the wrapped component without forwardRef", () => {
    /*
     * In React 19 `ref` is an ordinary prop, so it arrives in `props` and the
     * spread carries it onward like any other value. Under React 18 this HOC
     * would have had to be a `forwardRef` call threading the ref through by
     * hand, and one that forgot produced a `ref` that stayed `null` with no
     * warning anywhere.
     */
    function Field({ matches, ref }: MediaQueryInjectedProps & { ref?: Ref<HTMLInputElement> }) {
      return <input ref={ref} readOnly value={String(matches)} />;
    }
    const WrappedField = withMediaQuery(Field, WIDE);

    let node: HTMLInputElement | null = null;
    render(
      <WrappedField
        ref={(element) => {
          node = element;
        }}
      />,
    );

    expect(node).toBeInstanceOf(HTMLInputElement);
    expect(node!.value).toBe("false");
  });

  it("keeps the subtree mounted when the wrapper is created once", async () => {
    const user = userEvent.setup();
    const Wrapped = withMediaQuery(Counter, WIDE);

    function Parent() {
      const [, setTick] = useState(0);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setTick((n) => n + 1);
            }}
          >
            re-render
          </button>
          <Wrapped label="a" />
        </>
      );
    }

    render(<Parent />);
    await user.click(screen.getByRole("button", { name: "a:false:0" }));
    expect(screen.getByRole("button", { name: "a:false:1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "re-render" }));

    expect(screen.getByRole("button", { name: "a:false:1" })).toBeInTheDocument();
  });

  it("remounts the whole subtree when the wrapper is created during render", async () => {
    /*
     * The defect that makes "apply the HOC at module scope" a rule rather
     * than a style preference.
     *
     * `withMediaQuery(Counter, WIDE)` returns a *new function* every time it
     * is called. React compares element types by identity to decide whether to
     * update a fiber or replace it, so a wrapper built during render is a
     * different component type on every pass: the old tree is unmounted and a
     * new one mounted in its place. Every piece of state inside it is
     * discarded, every effect re-runs, and the DOM nodes are rebuilt — which
     * also means focus, scroll position and any in-flight text selection are
     * gone.
     *
     * Nothing about this shows up as an error. The component keeps rendering
     * the right thing; it just forgets. This test is the difference between
     * the two placements, and it is the only reason the escape hatch below is
     * written this way.
     */
    const user = userEvent.setup();

    function Parent() {
      const [, setTick] = useState(0);
      // Deliberate: the remount this causes is the subject of the test, and
      // the rule existing is the finding — it is what stops this being written
      // by accident. The disable goes on the *usage* below, not here, because
      // that is where `react-hooks/static-components` reports it.
      const Wrapped = withMediaQuery(Counter, WIDE);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setTick((n) => n + 1);
            }}
          >
            re-render
          </button>
          {/* eslint-disable-next-line react-hooks/static-components -- see above */}
          <Wrapped label="a" />
        </>
      );
    }

    render(<Parent />);
    await user.click(screen.getByRole("button", { name: "a:false:0" }));
    const before = screen.getByRole("button", { name: "a:false:1" });

    await user.click(screen.getByRole("button", { name: "re-render" }));

    // The count is back to zero: this is a different component instance.
    const after = screen.getByRole("button", { name: "a:false:0" });
    expect(after).not.toBe(before);
    expect(screen.queryByRole("button", { name: "a:false:1" })).not.toBeInTheDocument();
  });

  it("re-subscribes on every remount caused by that mistake", () => {
    // The same defect, seen from the subscription side: each remount is a new
    // component instance, so the media-query listener is torn down and
    // rebuilt. One wrapper created in render is one leaked subscribe/
    // unsubscribe pair per parent render.
    function Parent({ tick }: { tick: number }) {
      // Deliberate, as above.
      const Wrapped = withMediaQuery(Card, WIDE);
      return (
        <>
          <span>{tick}</span>
          {/* eslint-disable-next-line react-hooks/static-components -- see above */}
          <Wrapped />
        </>
      );
    }

    const { rerender } = render(<Parent tick={0} />);
    expect(media.addEventListener).toHaveBeenCalledTimes(1);

    rerender(<Parent tick={1} />);
    rerender(<Parent tick={2} />);

    expect(media.addEventListener).toHaveBeenCalledTimes(3);
    expect(media.removeEventListener).toHaveBeenCalledTimes(2);
  });
});

/**
 * Type-level assertions.
 *
 * None of these is observable at runtime — a HOC that leaks its injected prop
 * back into the caller's props renders perfectly happily — so `tsc` is the
 * assertion runner. Each `@ts-expect-error` fails `pnpm typecheck` and
 * `pnpm build`, not `pnpm test`, if the error it names stops being reported.
 */
export function withMediaQueryTypeAssertions() {
  const Wrapped = withMediaQuery(Card, WIDE);
  const WrappedCounter = withMediaQuery(Counter, WIDE);

  // The injected prop is subtracted from the caller's props: the caller no
  // longer *may* pass it, rather than passing it and being ignored.
  // @ts-expect-error — `matches` is supplied by the HOC.
  const injectedRejected = <Wrapped matches />;

  // ...and the caller's own props survive the subtraction intact.
  const callerPropsRequired = <WrappedCounter label="a" />;
  // @ts-expect-error — `label` is the wrapped component's own prop and is still required.
  const missingCallerProp = <WrappedCounter />;

  /*
   * The statics ride along in the type. This is the assertion that pins the
   * `Omit` in `HoistedStatics`: spelling the return type as
   * `ComponentType<…> & TStatics` also intersects the wrapped component's
   * *call signature* back in, JSX resolves the element against that instead,
   * and `<Wrapped />` starts demanding `matches` again — so the line above
   * would stop erroring and this one would keep compiling. Both halves have to
   * be checked, or the wrong fix looks right.
   */
  const staticsSurvive: readonly string[] = Wrapped.presets;

  return { injectedRejected, callerPropsRequired, missingCallerProp, staticsSurvive };
}
