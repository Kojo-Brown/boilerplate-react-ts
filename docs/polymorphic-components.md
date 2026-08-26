# Polymorphic components: the `as` prop with full type inference

`src/shared/lib/polymorphic.ts` holds the types; `Text` and `Button` are the two
worked examples; `/labs/polymorphic` drives both by hand.

```tsx
<Text as="h2" size="md">Heading that is not h2-sized</Text>
<Button as={Link} to={ROUTES.DASHBOARD} variant="primary">Dashboard</Button>
<Button as="a" href="https://example.com" target="_blank">Docs</Button>
```

"Full generic type inference" is four separate promises, and a polymorphic
component is only worth having if it keeps all four:

| Promise                              | Checked by                                   |
| ------------------------------------ | -------------------------------------------- |
| The element's own props come along   | `<Text as="label" htmlFor>` compiles         |
| Props the element lacks are rejected | `<Text as="span" htmlFor>` does not          |
| Required props stay required         | `<Button as={Link}>` without `to` does not   |
| `ref` follows `as`                   | `as="h3"` yields an `HTMLHeadingElement` ref |

None of those is observable at runtime — a wrong `as`/prop pairing renders
perfectly happily — so they are asserted with `@ts-expect-error` blocks at the
bottom of `polymorphic.test.tsx`, `Text.test.tsx` and `Button.test.tsx`. `tsc`
is their assertion runner: they fail `pnpm typecheck` and `pnpm build`, not
`pnpm test`.

## What React 19 changed

The reason polymorphic components used to be hard is that promise 4 fought the
other three. A component needing a `ref` had to go through `forwardRef`:

```ts
function forwardRef<T, P>(
  render: (props: P, ref: Ref<T>) => ReactNode,
): ForwardRefExoticComponent<P & RefAttributes<T>>;
```

`P` is inferred once, where `forwardRef` is called. Handing it a generic render
function instantiates that function's type parameter then and there — to its
default or its constraint — and what comes back is not generic at all.
`<Box as="a" href="/x">` on such a component does not infer `"a"`; it checks
`href` against whatever the parameter defaulted to and reports an error on a
prop that is entirely valid. Every library that shipped a polymorphic component
worked around this the same way: throw the inferred type away and assert a
hand-written generic call signature over the result, a cast nothing verifies.

In React 19 `ref` is an ordinary prop, so there is nothing left to wrap. A
plain generic function _is_ the component and its type parameter survives into
JSX. The cast is not replaced with a safer cast — it is gone:

```tsx
export function Text<TElement extends TextElement = "p">({
  as,
  ...props
}: PolymorphicProps<TElement, TextOwnProps>) {
  const Component = (as ?? "p") as ElementType;
  return <Component {...props} />;
}
```

This is the item's "modern equivalent": the pattern did not get a new API, it
got its reason for existing removed.

## Three things in the types that are not decoration

### `Omit` has to distribute

`Omit<A | B, K>` is not "omit `K` from each of `A` and `B`". It is built from
`keyof (A | B)` — the keys `A` and `B` have in _common_ — so it collapses the
union and discards every prop unique to either branch.

```ts
type Props = ComponentPropsWithRef<"a" | "button">;
type Collapsed = Omit<Props, "as">; // no href, no disabled
type Distributed = DistributiveOmit<Props, "as">; // both survive
```

A union reaches `TElement` more easily than it looks — `as={admin ? "a" :
"button"}` is enough, and so is the element picker on `/labs/polymorphic`,
which is typed as the whole nineteen-tag `TextElement` union. The symptom is
the confusing kind: a prop that is valid for the element actually being
rendered is reported as unknown.

### Own props and element props are joined by subtraction, not intersection

`TOwnProps & ComponentPropsWithRef<TElement>` is the obvious spelling and it is
unusable, for the reason already recorded in `mergeProps.ts`: TypeScript
reduces an intersection to `never` at the first property whose two declarations
do not overlap. `Button` declares `size?: "sm" | "md" | "lg"` and `input`
declares `size?: number`, so `<Button as="input">` would not merely mistype
`size` — it would make _every_ prop on that tag an error, reported at the JSX
tag with no mention of which name collided. `PolymorphicProps` removes
`keyof TOwnProps` from the element's props first, so the two halves never meet.

`"as"` is removed alongside them because `<link as="style">` and `<script as>`
genuinely declare an `as` attribute of their own.

### `as` must not reach the DOM

React writes an unrecognised lowercase prop straight through to the element
rather than dropping it or warning — `as` is a real attribute on `<link>`, so
it has no reason to complain. A forwarded `as` therefore lands in the markup as
a literal `as="h2"`, and every test that asserts on roles, text and styles
still passes. Both components destructure it; both test files assert the
rendered element has no `as` attribute.

## Disabling something that is not a `<button>`

This is the part of `Button` that polymorphism forced, and it is the strongest
argument for owning a prop rather than forwarding it.

`loading` is meaningful on every element `as` can name. `disabled` is an
attribute of `button`, `input`, `fieldset`, `select` and `textarea` and nothing
else. A polymorphic button that derives `disabled` from `loading` and forwards
it produces `<a disabled="">` — React treats `disabled` as a known property and
writes it to any element it is given, and no browser has ever honoured it on an
anchor. The link greys out and remains focusable, activatable and navigable,
with no warning logged anywhere. It is the worst available outcome because it
looks handled.

So `disabled` is one of `Button`'s own props, and the component picks the
mechanism that works for the element it turned out to be rendering:

| Element                                             | Mechanism                                |
| --------------------------------------------------- | ---------------------------------------- |
| `button`, `input`, `fieldset`, `select`, `textarea` | the `disabled` attribute                 |
| anything else — `a`, `Link`, a component            | `aria-disabled` plus a click interceptor |

Intercepting `click` covers the keyboard too: Enter on a focused anchor
dispatches a click, which is why there is no key handler in `Button.tsx`.
`preventDefault` is what stops the navigation. The tab order is deliberately
left alone — `tabIndex={-1}` would match `<button disabled>` more closely, but
a focusable element announcing `aria-disabled` is the ARIA-recommended
treatment for exactly this case, and reaching into the caller's `tabIndex` to
do it is a worse trade.

The disabled props are spread _after_ the caller's, so a stray `onClick` cannot
reinstate activation on a disabled control.

## Known limitations

**`Button` cannot render a void element at all.** React types `children` as
optional on every intrinsic element, including `input`, `img` and `br`, so
`<Button as="input">` compiles and then throws _"input is a void element tag
and must neither have `children` nor use `dangerouslySetInnerHTML`"_ at
runtime. Passing no children does not help: `Button` always renders the slot
`{loading && <svg />}{children}`, which is two expressions, so React receives a
two-element array however they evaluate — and a void element rejects a
`children` prop rather than a non-empty one. Both cases are pinned in
`Button.test.tsx`.

This is left as a limitation rather than fixed, because the fix would be worse.
`Button`'s content model _is_ children — a label with an optional spinner
beside it — and an `<input type="submit">` can hold neither. Building the
children conditionally would make `<Button as="input" loading>` render a
loading button with nowhere to put its spinner. A submit input is `<input>`,
not a `Button` talked into one.

Nothing in `PolymorphicProps` can close the underlying gap — the imprecision is
in React's own element types — and the only defence is constraining `TElement`
to an enumerated union, which is what `Text` does and what `Button`
deliberately does not, because its useful targets are components.

**A wrong `ref` is only caught when the target has members the supplied one
lacks.** DOM interfaces are structurally typed like everything else, and most
of them add nothing to `HTMLElement`. `HTMLHeadingElement` declares one
deprecated `align` member and `HTMLInputElement` happens to declare `align`
too, so a `RefObject<HTMLInputElement>` satisfies `<Text as="h3" ref>` with no
error. `ref` follows `as` exactly as promised; it is the DOM lib that has
nothing to compare. The assertion in `Text.test.tsx` pairs label ← paragraph
(`control`, `form` and `htmlFor` are missing) for this reason.

**`Button` narrows `className` to a string.** react-router's `Link` accepts a
function there; `Button` composes `className` through `cn`, which merges
strings. A caller who needs the function form wants `Link` directly rather than
a button that happens to navigate.

## When not to reach for this

An `as` prop is for one component with one behaviour that needs a different
_element_ — a button that must be an anchor because it navigates, a text
primitive whose type scale is independent of its document outline. It is not a
way to avoid writing a second component. If the props diverge past the point
where `TOwnProps` still describes all of them, or if the behaviour differs by
element rather than just the tag, two components are the smaller thing.
