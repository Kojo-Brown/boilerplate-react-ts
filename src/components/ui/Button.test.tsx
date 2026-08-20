import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, useLocation } from "react-router";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when loading is true", () => {
    render(<Button loading>Click me</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows spinner svg when loading", () => {
    const { container } = render(<Button loading>Click me</Button>);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Click me
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies primary variant class by default", () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole("button").className).toContain("bg-[var(--color-primary)]");
  });

  it("applies danger variant class", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button").className).toContain("bg-[var(--color-danger)]");
  });

  it("merges custom className", () => {
    render(<Button className="my-class">Click</Button>);
    expect(screen.getByRole("button").className).toContain("my-class");
  });
});

describe("Button — polymorphic `as`", () => {
  it("renders a button when `as` is omitted", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" }).tagName).toBe("BUTTON");
  });

  it('renders an anchor with `as="a"`, announced as a link', () => {
    render(
      <Button as="a" href="https://example.com">
        Docs
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Docs" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("renders a router Link with `as={Link}`, resolving `to` to an href", () => {
    render(
      <MemoryRouter>
        <Button as={Link} to="/dashboard">
          Dashboard
        </Button>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("does not forward `as` to the DOM", () => {
    render(
      <Button as="a" href="/x">
        Docs
      </Button>,
    );
    expect(screen.getByRole("link")).not.toHaveAttribute("as");
  });

  it("keeps the variant and size classes whatever the element", () => {
    render(
      <Button as="a" href="/x" variant="danger" size="lg">
        Delete
      </Button>,
    );
    expect(screen.getByRole("link").className).toContain("bg-[var(--color-danger)]");
    expect(screen.getByRole("link").className).toContain("h-12");
  });

  it("attaches a ref to the element `as` chose", () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <Button as="a" href="/x" ref={ref}>
        Docs
      </Button>,
    );
    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
  });
});

/**
 * Disabling a control that is not a `<button>`.
 *
 * These are the tests that justify `disabled` being one of the component's own
 * props rather than one it inherits from the element. The naive polymorphic
 * button forwards `disabled` — or derives it from `loading` — and forwards it
 * to whatever `as` named. On an anchor that produces `<a disabled="">`: a real
 * attribute, written without complaint by React, honoured by no browser. The
 * link greys out and stays fully operational, which is the worst of the
 * available outcomes because it looks handled.
 */
describe("Button — disabled across elements", () => {
  it("uses the native attribute on a button, and does not add aria-disabled", () => {
    render(<Button disabled>Save</Button>);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-disabled");
  });

  it("uses aria-disabled on an anchor, and never the inert attribute", () => {
    render(
      <Button as="a" href="/x" disabled>
        Docs
      </Button>,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).not.toHaveAttribute("disabled");
  });

  it("derives the same treatment from `loading` on a non-native element", () => {
    render(
      <Button as="a" href="/x" loading>
        Docs
      </Button>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("aria-disabled", "true");
  });

  it("suppresses activation on a disabled anchor", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button as="a" href="/x" disabled onClick={onClick}>
        Docs
      </Button>,
    );
    await user.click(screen.getByRole("link"));
    expect(onClick).not.toHaveBeenCalled();
  });

  /**
   * Enter on a focused anchor dispatches a click, so intercepting `click` is
   * what covers the keyboard as well — there is no separate key handler in
   * `Button.tsx` and this is why one is not needed.
   */
  it("suppresses keyboard activation on a disabled anchor", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button as="a" href="/x" disabled onClick={onClick}>
        Docs
      </Button>,
    );
    screen.getByRole("link").focus();
    await user.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not navigate when a disabled router Link is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/start"]}>
        <Button as={Link} to="/dashboard" disabled>
          Dashboard
        </Button>
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(screen.getByTestId("pathname")).toHaveTextContent("/start");
  });

  // A fragment href rather than `/x`: an undisabled anchor click is a real
  // navigation, and jsdom logs "Not implemented: navigation to another
  // Document" for one. The point here is the handler, not the destination.
  it("still activates when it is not disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button as="a" href="#docs" onClick={onClick}>
        Docs
      </Button>,
    );
    await user.click(screen.getByRole("link"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

/**
 * A recorded limitation rather than a behaviour worth having.
 *
 * React types `children` as optional on *every* intrinsic element, void ones
 * included, so `<Button as="input">` typechecks and then throws on render.
 * Nothing in `PolymorphicProps` can close that: the imprecision is in React's
 * own element types, and the only defence is constraining `TElement` to an
 * enumerated union — which is what `Text` does and what `Button` deliberately
 * does not, because its useful targets are other components.
 *
 * The second case is the one that decides how this gets documented. Passing no
 * children does not help, because `Button` always renders a children *slot* —
 * `{loading && <svg />}{children}` is two expressions, so React receives a
 * two-element array whichever way they evaluate, and a void element rejects a
 * `children` prop rather than a non-empty one. So the limitation is not "a
 * void element with children"; it is void elements at all, for this component.
 *
 * That is left as a limitation rather than fixed, and the reason is the
 * spinner. `Button`'s content model *is* children — a label with an optional
 * spinner beside it — and an `<input type="submit">` cannot contain either.
 * Building the children conditionally would make `<Button as="input">` render,
 * and it would render a `loading` button with nowhere to put the spinner.
 * A submit input is `<input>`, not a Button that has been talked into one.
 */
describe("Button — void elements are a known gap", () => {
  const VOID_ELEMENT_ERROR =
    "input is a void element tag and must neither have `children` nor use `dangerouslySetInnerHTML`.";

  it("throws for a void element given children, which the types allow", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Button as="input">Save</Button>)).toThrow(VOID_ELEMENT_ERROR);
    consoleError.mockRestore();
  });

  it("throws for a void element given none, because the children slot is always passed", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Button as="input" type="submit" value="Save" />)).toThrow(
      VOID_ELEMENT_ERROR,
    );
    consoleError.mockRestore();
  });
});

function LocationProbe() {
  const { pathname } = useLocation();
  return <span data-testid="pathname">{pathname}</span>;
}

/**
 * Type-level assertions.
 *
 * `tsc` is the assertion runner: each `@ts-expect-error` fails `pnpm
 * typecheck` and `pnpm build` — not `pnpm test` — if the error it names stops
 * being reported. Never rendered; a function that is only type-checked is how
 * that is guaranteed.
 */
export function ButtonTypeAssertions() {
  return (
    <>
      {/* Inference through `as`, including into another component's props. */}
      <Button as="a" href="/x" target="_blank" rel="noreferrer">
        Docs
      </Button>
      <Button as={Link} to="/dashboard" variant="secondary">
        Dashboard
      </Button>

      {/* @ts-expect-error — `href` is an anchor prop and the default element is a button. */}
      <Button href="/x">Not a link</Button>

      {/* @ts-expect-error — `to` is required by Link, and a component's required props stay required. */}
      <Button as={Link}>Nowhere</Button>

      {/*
        Not an error, and worth stating so: `type` on an anchor is the MIME
        hint for the linked resource, so the anchor props really do declare it.
        The inference is precise, not merely strict — an assertion that this
        failed would be asserting a bug.
      */}
      <Button as="a" href="/x" type="text/html">
        Docs
      </Button>

      {/* @ts-expect-error — `formAction` belongs to button and input; an anchor submits nothing. */}
      <Button as="a" href="/x" formAction="/save">
        Docs
      </Button>

      {/*
        The component's own `size` wins the name over the element's.

        `input` declares `size: number`, and this is the collision that makes
        the `Omit`-then-intersect spelling in `PolymorphicProps` load-bearing:
        `TOwnProps & ComponentPropsWithRef<TElement>` would reduce `size` to
        `never`, and with it every other prop on the tag, reporting an error
        that names none of the above.
      */}
      {/* @ts-expect-error — `size` here is the variant scale, not the input's character width. */}
      <Button as="input" size={20} />

      {/* @ts-expect-error — the variant union does not include arbitrary strings. */}
      <Button variant="tertiary">Click</Button>

      {/* @ts-expect-error — a ref for the wrong element: `as="a"` yields an HTMLAnchorElement. */}
      <Button as="a" href="/x" ref={{ current: null as HTMLParagraphElement | null }}>
        Docs
      </Button>
    </>
  );
}
