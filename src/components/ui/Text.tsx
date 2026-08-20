import type { ElementType } from "react";
import { cn } from "@/lib/cn";
import type { PolymorphicProps } from "@/lib/polymorphic";

/**
 * Typography primitive with a constrained `as`.
 *
 * The visual scale and the element are independent choices, and conflating
 * them is how a codebase ends up with an `<h3>` chosen because the designer
 * wanted 20px type. `<Text as="h2" size="md">` says the two things separately:
 * `as` is the document outline, `size` is the type scale.
 *
 * `TElement` is constrained to {@link TextElement} rather than left open at
 * `ElementType`, which is the difference between "polymorphic" and "renders
 * whatever you name". A text primitive that accepts `as="input"` accepts a
 * combination with no meaning — `size` would collide, `children` would throw —
 * and the constraint costs nothing, because narrowing the parameter does not
 * narrow the inference: `<Text as="label">` still solves `TElement` to
 * `"label"` and still accepts `htmlFor`.
 */

/**
 * The elements this primitive may render.
 *
 * Phrasing content plus the block-level containers that hold it. `div` is
 * present because a paragraph is invalid inside another paragraph and
 * sometimes the wrapper genuinely has no semantics to offer; `li` because a
 * list item is text more often than it is structure.
 */
export const TEXT_ELEMENTS = [
  "p",
  "span",
  "div",
  "label",
  "strong",
  "em",
  "small",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "dt",
  "dd",
  "figcaption",
  "blockquote",
  "legend",
] as const;

/** Union of the tags {@link Text} accepts as `as`. */
export type TextElement = (typeof TEXT_ELEMENTS)[number];

type Tone = "default" | "muted" | "primary" | "danger";
type Size = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
type Weight = "normal" | "medium" | "semibold" | "bold";

/** The props {@link Text} adds on top of whichever element `as` names. */
export interface TextOwnProps {
  tone?: Tone;
  size?: Size;
  weight?: Weight;
  /** Truncates to a single line with an ellipsis. */
  truncate?: boolean;
}

const toneClasses: Record<Tone, string> = {
  default: "text-[var(--color-fg)]",
  muted: "text-[var(--color-muted-fg)]",
  primary: "text-[var(--color-primary)]",
  danger: "text-[var(--color-danger)]",
};

const sizeClasses: Record<Size, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
};

const weightClasses: Record<Weight, string> = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

export function Text<TElement extends TextElement = "p">({
  as,
  tone = "default",
  size = "md",
  weight = "normal",
  truncate = false,
  className,
  ...props
}: PolymorphicProps<TElement, TextOwnProps>) {
  // `as` is destructured rather than spread onward, which is the whole reason
  // this line exists: React passes an unrecognised lowercase prop straight
  // through to the DOM, so a forwarded `as` would land in the markup as a
  // literal `as="h2"` attribute with no warning of any kind to notice it by.
  // `Text.test.tsx` asserts the rendered element carries no `as` attribute.
  const Component = (as ?? "p") as ElementType;

  return (
    <Component
      className={cn(
        toneClasses[tone],
        sizeClasses[size],
        weightClasses[weight],
        truncate && "truncate",
        className,
      )}
      {...props}
    />
  );
}
