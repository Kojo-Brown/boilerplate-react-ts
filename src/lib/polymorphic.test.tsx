import type { ComponentPropsWithRef } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/Button";
import type { DistributiveOmit, PolymorphicProps } from "@/lib/polymorphic";

/**
 * `polymorphic.ts` exports types and nothing else, so most of what it promises
 * is checked by `pnpm typecheck` in the assertion blocks at the bottom of this
 * file rather than by anything here. The runtime tests cover the one claim
 * that has an observable consequence: a union-typed `as` still renders, and
 * still carries the props of whichever branch it resolved to.
 */

describe("a union-typed `as`", () => {
  /**
   * `as={admin ? "a" : "button"}` is the ordinary way a union reaches
   * `TElement` — no one writes the union by hand, they write a conditional.
   * With plain `Omit` in `PolymorphicProps` this does not compile: the union
   * collapses to the keys `a` and `button` share, and `href` is reported as
   * unknown on a component that is about to render an anchor.
   */
  it.each([
    ["a" as const, "A"],
    ["button" as const, "BUTTON"],
  ])("renders %s from a conditional `as`", (tag, expectedTagName) => {
    render(
      <Button as={tag} href="#docs">
        Docs
      </Button>,
    );
    expect(screen.getByText("Docs").tagName).toBe(expectedTagName);
  });

  it("keeps the props of the branch that was chosen", () => {
    const tag: "a" | "button" = "a";
    render(
      <Button as={tag} href="#docs" rel="noreferrer">
        Docs
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("rel", "noreferrer");
  });
});

/**
 * Type-level assertions.
 *
 * `tsc` is the assertion runner: each `@ts-expect-error` fails `pnpm
 * typecheck` and `pnpm build` — not `pnpm test` — if the error it names stops
 * being reported.
 */

type AnchorOrButton = ComponentPropsWithRef<"a" | "button">;

/**
 * The whole argument for `DistributiveOmit` in one block.
 *
 * `Omit<A | B, K>` is not "omit K from each of A and B". It is built from
 * `keyof (A | B)`, which is the keys A and B have in *common*, so the result
 * is a single object type that has lost every prop unique to either branch.
 * The two lines below differ only in which `Omit` produced their type.
 */
export function distributiveOmitAssertions() {
  // @ts-expect-error — plain `Omit` collapsed the union; `href` did not survive it.
  const collapsedAnchor: Omit<AnchorOrButton, "as"> = { href: "/x" };
  // @ts-expect-error — nor did `disabled`, from the other branch.
  const collapsedButton: Omit<AnchorOrButton, "as"> = { disabled: true };

  // Distributing over the union keeps both branches intact.
  const distributedAnchor: DistributiveOmit<AnchorOrButton, "as"> = { href: "/x" };
  const distributedButton: DistributiveOmit<AnchorOrButton, "as"> = { disabled: true };

  return { collapsedAnchor, collapsedButton, distributedAnchor, distributedButton };
}

/**
 * `as` is the component's, even when the element declares one of its own.
 *
 * `<link as="style">` and `<script as>` are real: both declare an `as`
 * attribute. `PolymorphicProps` removes `"as"` from the element's props before
 * merging, so the surviving `as` is the element selector and is typed as the
 * element union rather than as the HTML attribute's `string`.
 */
export function asPropOwnershipAssertions() {
  const chooseTheElement: PolymorphicProps<"link">["as"] = "link";

  // @ts-expect-error — `as` selects the element; it is not the preload hint of `<link as="style">`.
  const notThePreloadHint: PolymorphicProps<"link">["as"] = "style";

  return { chooseTheElement, notThePreloadHint };
}
