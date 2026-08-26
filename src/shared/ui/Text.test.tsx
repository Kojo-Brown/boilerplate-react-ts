import { createRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Text } from "@/shared/ui/Text";

describe("Text", () => {
  it("renders a paragraph when `as` is omitted", () => {
    render(<Text>Body copy</Text>);
    expect(screen.getByText("Body copy").tagName).toBe("P");
  });

  it("renders the element named by `as`", () => {
    render(<Text as="h2">Section</Text>);
    expect(screen.getByRole("heading", { level: 2, name: "Section" })).toBeInTheDocument();
  });

  /**
   * The failure this pins is silent in both directions.
   *
   * React writes an unrecognised lowercase prop straight through to the DOM
   * rather than dropping it or warning about it, so forwarding `as` produces a
   * literal `as="h2"` attribute on the element. Nothing looks wrong: the
   * component renders the right tag, the styles apply, the tests that assert
   * on roles and text all pass, and the only trace is an attribute in the
   * markup that no one reads. `as` is a real attribute on `<link>` and
   * `<script>`, which is why React has no reason to complain about it.
   */
  it("does not forward `as` to the DOM", () => {
    render(<Text as="h2">Section</Text>);
    expect(screen.getByRole("heading", { level: 2 })).not.toHaveAttribute("as");
  });

  it("keeps the element's own props — `htmlFor` on a label", () => {
    render(
      <>
        <Text as="label" htmlFor="email">
          Email
        </Text>
        <input id="email" />
      </>,
    );
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  /**
   * `ref` follows `as` at runtime as well as in the type. In React 19 it
   * arrives as an ordinary prop and is spread onward with everything else —
   * there is no `forwardRef` in `Text.tsx` to route it.
   */
  it("attaches a ref to the element `as` chose", () => {
    const ref = createRef<HTMLHeadingElement>();
    render(
      <Text as="h3" ref={ref}>
        Heading
      </Text>,
    );
    expect(ref.current).toBeInstanceOf(HTMLHeadingElement);
    expect(ref.current?.tagName).toBe("H3");
  });

  it("applies tone, size and weight classes", () => {
    render(
      <Text tone="danger" size="lg" weight="bold">
        Warning
      </Text>,
    );
    const el = screen.getByText("Warning");
    expect(el).toHaveClass("text-[var(--color-danger)]", "text-lg", "font-bold");
  });

  it("truncates only when asked", () => {
    const { rerender } = render(<Text truncate>Long</Text>);
    expect(screen.getByText("Long")).toHaveClass("truncate");

    rerender(<Text>Long</Text>);
    expect(screen.getByText("Long")).not.toHaveClass("truncate");
  });

  /**
   * The caller's `className` goes through `cn`, so a Tailwind conflict
   * resolves the caller's way rather than by string order — `size="md"`
   * contributes `text-base` and the caller's `text-sm` replaces it instead of
   * both landing in the class list for the cascade to arbitrate.
   */
  it("lets the caller's className win a Tailwind conflict", () => {
    render(
      <Text size="md" className="text-sm">
        Small
      </Text>,
    );
    const el = screen.getByText("Small");
    expect(el).toHaveClass("text-sm");
    expect(el).not.toHaveClass("text-base");
  });
});

/**
 * Type-level assertions.
 *
 * `tsc` is the assertion runner: each `@ts-expect-error` fails `pnpm
 * typecheck` and `pnpm build` — not `pnpm test` — if the error it names stops
 * being reported. They are never rendered, and a function that is only
 * type-checked is the way to keep it that way (`describe.skip` would still
 * construct the elements).
 */
export function TextTypeAssertions() {
  return (
    <>
      {/* Inference through `as`: each element contributes its own props. */}
      <Text as="label" htmlFor="email">
        Email
      </Text>
      <Text as="blockquote" cite="https://example.com">
        Quoted
      </Text>

      {/* @ts-expect-error — `htmlFor` belongs to `label`, and this is a span. */}
      <Text as="span" htmlFor="email">
        Not a label
      </Text>

      {/* @ts-expect-error — the default element is `p`, which has no `href`. */}
      <Text href="/somewhere">Not a link</Text>

      {/* @ts-expect-error — `as` is constrained to text elements; `input` is not one. */}
      <Text as="input" />

      {/* @ts-expect-error — the tone union does not include an arbitrary colour. */}
      <Text tone="chartreuse">Tone</Text>

      {/*
        A ref for the wrong element.

        This one is worth more than the others because of what it does *not*
        catch. DOM interfaces are structurally typed like everything else, and
        most of them add nothing to `HTMLElement` — `HTMLHeadingElement`
        declares one deprecated `align` member, and `HTMLInputElement` happens
        to declare `align` too, so a `RefObject<HTMLInputElement>` satisfies
        `<Text as="h3" ref>` with no error at all. `ref` follows `as` exactly
        as promised; it is the DOM lib that has nothing to compare. The check
        only bites when the target element has members the supplied one lacks,
        which is why the pair here is label ← paragraph (`control`, `form` and
        `htmlFor` are missing) rather than anything involving a heading.
      */}
      {/* @ts-expect-error — `as="label"` yields an HTMLLabelElement, not a paragraph. */}
      <Text as="label" ref={{ current: null as HTMLParagraphElement | null }}>
        Email
      </Text>
    </>
  );
}
