import { describe, it, expect, vi } from "vitest";
import {
  mergeProps,
  mergeRefs,
  preventHookDefault,
  isHookDefaultPrevented,
} from "@/shared/lib/mergeProps";

describe("mergeProps — handlers", () => {
  it("runs both handlers, the caller's first", () => {
    const order: string[] = [];
    const merged = mergeProps(
      {
        onClick: () => {
          order.push("hook");
        },
      },
      {
        onClick: () => {
          order.push("caller");
        },
      },
    );

    merged.onClick();

    expect(order).toEqual(["caller", "hook"]);
  });

  it("passes every argument through to both handlers", () => {
    const hook = vi.fn();
    const caller = vi.fn();
    const event = {};

    mergeProps({ onKeyDown: hook }, { onKeyDown: caller }).onKeyDown(event, "extra");

    expect(caller).toHaveBeenCalledWith(event, "extra");
    expect(hook).toHaveBeenCalledWith(event, "extra");
  });

  it("skips the hook's handler when the caller opts out", () => {
    const hook = vi.fn();
    const event = {};

    mergeProps(
      { onClick: hook },
      {
        onClick: (received: object) => {
          preventHookDefault(received);
        },
      },
    ).onClick(event);

    expect(hook).not.toHaveBeenCalled();
  });

  /*
   * The whole reason `preventHookDefault` exists rather than reading
   * `defaultPrevented`. Stopping the page scrolling under an arrow key is the
   * commonest thing a caller's key handler does, and it says nothing about
   * wanting the hook's key handling turned off. Reading the DOM flag here
   * would leave the arrow keys dead with nothing to explain it.
   */
  it("still runs the hook's handler when the caller only calls preventDefault", () => {
    const hook = vi.fn();
    const event = { defaultPrevented: false, preventDefault: vi.fn() };

    mergeProps(
      { onKeyDown: hook },
      {
        onKeyDown: (received: typeof event) => {
          received.preventDefault();
          received.defaultPrevented = true;
        },
      },
    ).onKeyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(hook).toHaveBeenCalledOnce();
  });

  it("marks only the event it was given", () => {
    const marked = {};
    const other = {};
    preventHookDefault(marked);

    expect(isHookDefaultPrevented(marked)).toBe(true);
    expect(isHookDefaultPrevented(other)).toBe(false);
    expect(isHookDefaultPrevented(null)).toBe(false);
    expect(isHookDefaultPrevented("keydown")).toBe(false);
  });

  it("lets a caller replace a handler with a non-function value", () => {
    const merged = mergeProps({ onClick: () => undefined }, { onClick: null });
    expect(merged.onClick).toBeNull();
  });

  it("does not chain props that merely start with 'on'", () => {
    const hook = vi.fn();
    const caller = vi.fn();
    const merged = mergeProps({ onceReady: hook }, { onceReady: caller });

    expect(merged.onceReady).toBe(caller);
  });
});

describe("mergeProps — values", () => {
  it("merges className so the caller wins a Tailwind conflict", () => {
    expect(mergeProps({ className: "px-2 text-sm" }, { className: "px-6" }).className).toBe(
      "text-sm px-6",
    );
  });

  it("shallow-merges style with the caller's declarations last", () => {
    const merged = mergeProps({ style: { color: "red", margin: 0 } }, { style: { color: "blue" } });

    expect(merged.style).toEqual({ color: "blue", margin: 0 });
  });

  it("lets the caller override any other prop", () => {
    expect(mergeProps({ tabIndex: 0, role: "listbox" }, { tabIndex: -1 })).toEqual({
      tabIndex: -1,
      role: "listbox",
    });
  });

  /*
   * `onClick={undefined}` is what an optional prop looks like when the caller
   * never passed one down, so reading it as "delete the hook's behaviour"
   * would break the component from a prop nobody set.
   */
  it("treats an undefined caller value as 'not supplied'", () => {
    const hook = vi.fn();
    const merged = mergeProps({ onClick: hook, role: "option" }, { onClick: undefined });

    expect(merged.onClick).toBe(hook);
    expect(merged.role).toBe("option");
  });

  it("takes the caller's value when the hook has none", () => {
    expect(mergeProps({ id: "a", title: undefined }, { title: "hint" }).title).toBe("hint");
  });

  it("returns the hook's props untouched when there are no caller props", () => {
    const base = { role: "listbox" };
    expect(mergeProps(base, undefined)).toBe(base);
  });
});

describe("mergeRefs", () => {
  it("gives the node to an object ref and a callback ref alike", () => {
    const objectRef: { current: string | null } = { current: null };
    const callbackRef = vi.fn();

    mergeRefs<string>(objectRef, callbackRef)("node");

    expect(objectRef.current).toBe("node");
    expect(callbackRef).toHaveBeenCalledWith("node");
  });

  it("ignores absent refs", () => {
    const objectRef: { current: string | null } = { current: null };
    expect(() => mergeRefs<string>(undefined, null, objectRef)("node")).not.toThrow();
    expect(objectRef.current).toBe("node");
  });

  /*
   * React 19 stops calling a ref callback with `null` once that callback
   * returns a cleanup function — and a merged callback always returns one, so
   * unwinding the refs that have no cleanup of their own becomes its job. Miss
   * this and an object ref keeps a detached node alive for as long as whatever
   * holds the ref does.
   */
  it("nulls out refs that have no cleanup of their own", () => {
    const objectRef: { current: string | null } = { current: null };
    const plainCallback = vi.fn();

    const cleanup = mergeRefs<string>(objectRef, plainCallback)("node");
    cleanup();

    expect(objectRef.current).toBeNull();
    expect(plainCallback).toHaveBeenLastCalledWith(null);
  });

  it("uses a callback ref's own cleanup instead of calling it with null", () => {
    const cleanupSpy = vi.fn();
    const callbackRef = vi.fn(() => cleanupSpy);

    const cleanup = mergeRefs<string>(callbackRef)("node");
    cleanup();

    expect(cleanupSpy).toHaveBeenCalledOnce();
    expect(callbackRef).toHaveBeenCalledExactlyOnceWith("node");
  });

  it("merges refs supplied through mergeProps rather than dropping one", () => {
    const hookRef = vi.fn();
    const callerRef = vi.fn();

    mergeProps({ ref: hookRef }, { ref: callerRef }).ref("node");

    expect(hookRef).toHaveBeenCalledWith("node");
    expect(callerRef).toHaveBeenCalledWith("node");
  });
});
