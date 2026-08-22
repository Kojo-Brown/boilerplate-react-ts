import { describe, it, expect } from "vitest";
import { copyStatics, getDisplayName, wrapDisplayName } from "@/lib/hoc";

describe("getDisplayName", () => {
  it("uses an explicit displayName over the function name", () => {
    function Card() {
      return null;
    }
    Card.displayName = "PricingCard";
    expect(getDisplayName(Card)).toBe("PricingCard");
  });

  it("falls back to the function name", () => {
    function Card() {
      return null;
    }
    expect(getDisplayName(Card)).toBe("Card");
  });

  it("names an anonymous component rather than returning an empty string", () => {
    // A function expression that is never assigned to a binding has
    // `name === ""`. Devtools renders that as a blank node, so the fallback
    // has to check for the empty string and not just for undefined.
    const anonymous = (
      () => () =>
        null
    )() as { (): null; displayName?: string };
    expect(anonymous.name).toBe("");
    expect(getDisplayName(anonymous)).toBe("Component");
  });

  it("passes a host element name straight through", () => {
    expect(getDisplayName("div")).toBe("div");
  });
});

describe("wrapDisplayName", () => {
  it("names the wrapper after the HOC and what it wrapped", () => {
    function Banner() {
      return null;
    }
    expect(wrapDisplayName(Banner, "withMediaQuery")).toBe("withMediaQuery(Banner)");
  });

  it("nests, so a stack of wrappers stays readable", () => {
    function Banner() {
      return null;
    }
    const once = {
      displayName: wrapDisplayName(Banner, "withMediaQuery"),
    } as never as (() => null) & {
      displayName: string;
    };
    expect(wrapDisplayName(once, "withBoundary")).toBe("withBoundary(withMediaQuery(Banner))");
  });
});

describe("copyStatics", () => {
  it("copies the wrapped component's own statics onto the wrapper", () => {
    function Wrapper() {
      return null;
    }
    function Card() {
      return null;
    }
    Card.presets = ["compact", "full"];

    const hoisted = copyStatics(Wrapper, Card);

    expect(hoisted.presets).toEqual(["compact", "full"]);
  });

  it("copies symbol-keyed statics", () => {
    // How a library marks its own component types. A wrapper that loses the
    // mark stops being recognised by the library that made it, and nothing
    // reports an error — it just silently stops being that kind of thing.
    const marker = Symbol("library.kind");
    function Wrapper() {
      return null;
    }
    const Card = Object.assign(() => null, { [marker]: "card" });

    copyStatics(Wrapper, Card);

    expect((Wrapper as unknown as Record<symbol, string>)[marker]).toBe("card");
  });

  it("does not overwrite the wrapper's own displayName", () => {
    // The whole reason `displayName` is on the skip list: the wrapper has just
    // been named after what it wraps, and copying would undo that and make
    // every wrapper claim to be its inner component.
    const Wrapper = Object.assign(() => null, { displayName: "withMediaQuery(Card)" });
    const Card = Object.assign(() => null, { displayName: "Card" });

    copyStatics(Wrapper, Card);

    expect(Wrapper.displayName).toBe("withMediaQuery(Card)");
  });

  it("leaves React's own statics behind", () => {
    function Wrapper() {
      return null;
    }
    const Card = Object.assign(() => null, {
      defaultProps: { tone: "muted" },
      propTypes: { tone: null },
      contextType: null,
    });

    copyStatics(Wrapper, Card);

    expect(Object.hasOwn(Wrapper, "defaultProps")).toBe(false);
    expect(Object.hasOwn(Wrapper, "propTypes")).toBe(false);
    expect(Object.hasOwn(Wrapper, "contextType")).toBe(false);
  });

  it("leaves the wrapper's function identity intact", () => {
    // `name` and `length` are own properties of every function and they are
    // non-writable. Copying them either throws in strict mode or renames the
    // wrapper after the thing it wraps, which defeats `wrapDisplayName`.
    function Wrapper() {
      return null;
    }
    function Card(_props: { tone: string }) {
      return null;
    }

    copyStatics(Wrapper, Card);

    expect(Wrapper.name).toBe("Wrapper");
    expect(Wrapper.length).toBe(0);
  });

  it("does not copy $$typeof, which would change what React renders", () => {
    function Wrapper() {
      return null;
    }
    // `memo`, `forwardRef`, `lazy` and context objects all carry one. React
    // dispatches on it, so a plain function that acquires one is rendered as
    // whichever element type it now claims to be.
    const Memoised = Object.assign(() => null, { $$typeof: Symbol.for("react.memo") });

    copyStatics(Wrapper, Memoised);

    expect(Object.hasOwn(Wrapper, "$$typeof")).toBe(false);
  });

  it("keeps a non-configurable property on the target rather than throwing", () => {
    function Wrapper() {
      return null;
    }
    Object.defineProperty(Wrapper, "kind", {
      value: "wrapper",
      configurable: false,
      writable: false,
    });
    const Card = Object.assign(() => null, { kind: "card" });

    expect(() => copyStatics(Wrapper, Card)).not.toThrow();
    expect((Wrapper as unknown as { kind: string }).kind).toBe("wrapper");
  });

  it("returns the same object it was given", () => {
    // The return value exists to carry the statics in the *type*; it is not a
    // copy. A HOC that returned something else here would return a component
    // whose identity differed from the one it named.
    function Wrapper() {
      return null;
    }
    const Card = Object.assign(() => null, { presets: [] });

    expect(copyStatics(Wrapper, Card)).toBe(Wrapper);
  });
});
