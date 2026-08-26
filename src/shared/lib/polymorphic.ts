import type { ComponentPropsWithRef, ElementType } from "react";

/**
 * The types behind an `as` prop.
 *
 * A polymorphic component lets the caller choose the element it renders —
 * `<Text as="h1">`, `<Button as={Link} to="/dashboard">` — without giving up
 * anything the chosen element knows about itself. "Full generic type
 * inference" is the whole requirement, and it is four separate promises:
 *
 * 1. The element's own props come along. `as="a"` accepts `href`; `as="input"`
 *    accepts `value`; neither is accepted on the default element.
 * 2. Props the element does *not* have are rejected. `<Text as="span" href>`
 *    is an error, not a stray attribute in the DOM.
 * 3. Required props stay required. `as={Link}` without `to` fails to compile.
 * 4. `ref` follows `as`. `as="input"` wants a `RefObject<HTMLInputElement>`
 *    and rejects a `RefObject<HTMLDivElement>`.
 *
 * Every one of those is a claim `tsc` can check and no runtime test can, which
 * is why the assertions for this file live in `@ts-expect-error` blocks at the
 * bottom of `polymorphic.test.tsx`, `Text.test.tsx` and `Button.test.tsx`, and
 * are run by `pnpm typecheck` and `pnpm build` rather than by `pnpm test`.
 *
 * ## Why this is no longer built on `forwardRef`
 *
 * The historical reason polymorphic components were hard is that promise 4
 * fought promise 1-3. Anything needing a `ref` had to go through
 * `forwardRef`, whose signature is, in essence:
 *
 * ```ts
 * function forwardRef<T, P>(render: (props: P, ref: Ref<T>) => ReactNode):
 *   ForwardRefExoticComponent<P & RefAttributes<T>>;
 * ```
 *
 * `P` is inferred once, at the point of the `forwardRef` call. A generic
 * render function handed to it is instantiated there and then — its type
 * parameter is solved to its default or its constraint and the component that
 * comes back is not generic at all. `<Box as="a" href="/x">` on such a
 * component does not infer `"a"`; it checks `href` against whatever the
 * parameter defaulted to, and reports an error on a prop that is perfectly
 * valid. The published workaround, in every library that shipped one, was to
 * throw away the inferred type and assert a hand-written generic call
 * signature over the result — a cast whose correctness nothing checks.
 *
 * React 19 makes `ref` an ordinary prop of a function component, so there is
 * nothing left to wrap. A plain generic function *is* the component, its type
 * parameter survives into JSX, and the cast is not replaced by a better cast —
 * it is gone. That is the entire modern implementation:
 *
 * ```tsx
 * export function Text<TElement extends TextElement = "p">({
 *   as,
 *   ...props
 * }: PolymorphicProps<TElement, TextOwnProps>) { ... }
 * ```
 */

/**
 * The prop that chooses the element.
 *
 * It is optional, and it is what TypeScript infers `TElement` *from*. That is
 * the reason a polymorphic component takes its element as a type parameter
 * with a default rather than reading a constant: with `as` present in the
 * props, `<Text as="h1">` solves `TElement` to the literal `"h1"` and the rest
 * of the props are checked against `h1`; with `as` absent, the parameter's
 * default supplies the element instead.
 */
export type AsProp<TElement extends ElementType> = {
  as?: TElement;
};

/**
 * `Omit`, but it distributes over a union instead of collapsing it.
 *
 * This is not a stylistic preference. `Omit<A | B, K>` is a single object type
 * built from `keyof (A | B)` — the keys A and B have *in common* — so omitting
 * one key from a union of props silently discards every prop that is not
 * shared by all members:
 *
 * ```ts
 * type Props = ComponentPropsWithRef<"a" | "button">;
 * type Collapsed = Omit<Props, "as">;             // no `href`, no `disabled`
 * type Distributed = DistributiveOmit<Props, "as">; // both survive
 * ```
 *
 * A union reaches `TElement` more easily than it looks: `as={admin ? "a" :
 * "button"}` is enough, and so is any wrapper that passes `as` through with a
 * union type of its own. The failure it produces is the confusing kind — a
 * prop that is valid for the element the component actually renders is
 * reported as unknown — so this is `DistributiveOmit` everywhere rather than
 * `Omit` until something breaks.
 */
export type DistributiveOmit<T, TKeys extends PropertyKey> = T extends unknown
  ? Omit<T, TKeys>
  : never;

/**
 * The full prop type of a polymorphic component.
 *
 * `TOwnProps` are the component's own props — `variant`, `tone`, whatever it
 * adds — and they win any name they share with the element. `as="input"` on a
 * component with its own `size?: "sm" | "lg"` is the case that makes the
 * direction matter: `input` has a numeric `size` attribute, so the two must
 * not both be in play.
 *
 * Note that the two halves are joined by removing keys, not by intersecting
 * them. `TOwnProps & ComponentPropsWithRef<TElement>` is the obvious spelling
 * and it is unusable for exactly the reason recorded in `mergeProps.ts`:
 * TypeScript reduces an intersection to `never` on the first property whose
 * two declarations do not overlap, and `size: "sm" | "lg"` against
 * `size: number` is that property. The result is not a mistyped `size` — it is
 * a component whose *every* prop is an error, reported at the JSX tag with no
 * indication of which name collided.
 *
 * `"as"` is removed alongside `keyof TOwnProps` because `AsProp` contributes
 * it, and because two element types genuinely declare an `as` attribute of
 * their own: `<link as="style">` and `<script as>`. Without the exclusion,
 * `PolymorphicProps<"link">` would offer two conflicting `as` props.
 */
export type PolymorphicProps<
  TElement extends ElementType,
  TOwnProps extends object = Record<never, never>,
> = TOwnProps &
  AsProp<TElement> &
  DistributiveOmit<ComponentPropsWithRef<TElement>, "as" | keyof TOwnProps>;

/**
 * The `ref` type for whatever `as` resolved to.
 *
 * Rarely needed in a component body — `ref` arrives inside the props and is
 * spread onward with everything else — but a caller declaring a ref to *pass*
 * wants to name its type without hardcoding an element:
 *
 * ```ts
 * const ref = useRef<ElementRef<"input">>(null);
 * ```
 */
export type PolymorphicRef<TElement extends ElementType> = ComponentPropsWithRef<TElement>["ref"];
