import { useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/Button";
import { Text, TEXT_ELEMENTS, type TextElement } from "@/shared/ui/Text";
import { ROUTES } from "@/shared/routes/paths";

/**
 * Harness for the polymorphic `as` prop.
 *
 * Two things here are worth driving by hand rather than reading about.
 *
 * The element picker changes the tag `<Text>` renders without changing
 * anything else about it — same styles, same content, different document
 * outline — which is the separation the component exists to make possible.
 * The rendered tag is displayed beside it, because "this is an `h2` now" is
 * otherwise invisible in a screenshot.
 *
 * The disabled row is the one that matters. Three controls that look
 * identical: a real `<button>`, an `<a>`, and a router `<Link>`. Disable them
 * and the button stops because the browser stops it, while the other two stop
 * only because `Button` noticed it could not use the attribute and reached for
 * `aria-disabled` and a click interceptor instead. The click counter is there
 * so the difference is countable — a link that navigates and a link that does
 * not are the same screenshot.
 */
export function PolymorphicLabPage() {
  const [element, setElement] = useState<TextElement>("p");
  const [disabled, setDisabled] = useState(true);
  const [clicks, setClicks] = useState(0);
  // `HTMLElement` does not compile here, and that is the promise working:
  // `as="h3"` resolves the ref to `HTMLHeadingElement`, so a ref declared one
  // step too wide is rejected at the tag rather than silently accepted.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [measured, setMeasured] = useState<string | null>(null);

  return (
    <main className="flex flex-col gap-10 p-8">
      <header className="flex flex-col gap-2">
        <Text as="h1" size="2xl" weight="bold">
          Polymorphic Lab
        </Text>
        <Text tone="muted" className="max-w-2xl">
          One component, any element, and the element&apos;s own props inferred from the{" "}
          <code>as</code> you passed. Everything on this page is typed: the picker below can only
          offer tags <code>Text</code> accepts, and the router link cannot be written without a{" "}
          <code>to</code>.
        </Text>
      </header>

      <section className="flex flex-col gap-4">
        <Text as="h2" size="xl" weight="semibold">
          The element is a choice, the type scale is a different choice
        </Text>
        <div className="flex flex-wrap gap-2">
          {TEXT_ELEMENTS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => {
                setElement(tag);
              }}
              aria-pressed={element === tag}
              className={cn(
                "rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 font-mono text-xs",
                element === tag
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                  : "hover:bg-[var(--color-muted)]",
              )}
            >
              {tag}
            </button>
          ))}
        </div>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
          {/*
            `as={element}` is the union case: `element` is typed as the whole
            `TextElement` union, not a literal, so `PolymorphicProps` is
            resolving props for nineteen tags at once. It compiles because
            `DistributiveOmit` keeps the union a union — plain `Omit` would
            collapse it to the keys all nineteen share.
          */}
          <Text as={element} size="lg" weight="medium">
            The quick brown fox jumps over the lazy dog.
          </Text>
        </div>
        <Text tone="muted" size="sm">
          Rendering <code data-testid="chosen-element">&lt;{element}&gt;</code> — identical styling,
          different semantics. Inspect it: there is no <code>as</code> attribute in the DOM.
        </Text>
      </section>

      <section className="flex flex-col gap-4">
        <Text as="h2" size="xl" weight="semibold">
          Disabled means something different on every element
        </Text>

        <label className="flex w-fit items-center gap-2">
          <input
            type="checkbox"
            checked={disabled}
            onChange={(event) => {
              setDisabled(event.target.checked);
            }}
          />
          <Text as="span">Disable all three</Text>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={disabled}
            onClick={() => {
              setClicks((n) => n + 1);
            }}
          >
            Native button
          </Button>
          <Button
            as="a"
            href="#counted"
            disabled={disabled}
            onClick={() => {
              setClicks((n) => n + 1);
            }}
          >
            Anchor
          </Button>
          <Button as={Link} to={ROUTES.ABOUT} disabled={disabled} variant="secondary">
            Router Link
          </Button>
        </div>

        <Text tone="muted" size="sm">
          Activations counted: <strong data-testid="click-count">{clicks}</strong>. The button
          carries a real <code>disabled</code> attribute; the other two carry{" "}
          <code>aria-disabled</code>, because no browser has ever honoured{" "}
          <code>&lt;a disabled&gt;</code>.
        </Text>
      </section>

      <section className="flex flex-col gap-4">
        <Text as="h2" size="xl" weight="semibold">
          A ref follows <code>as</code>
        </Text>
        <Text as="h3" ref={headingRef} size="lg" weight="semibold">
          Measure this heading
        </Text>
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setMeasured(headingRef.current?.tagName ?? null);
            }}
          >
            Read the node
          </Button>
        </div>
        <Text tone="muted" size="sm">
          {measured === null ? (
            "Nothing read yet."
          ) : (
            <>
              The ref holds a <code data-testid="measured-tag">{measured}</code> element. Its type
              is <code>HTMLHeadingElement</code> because <code>as=&quot;h3&quot;</code> said so — no{" "}
              <code>forwardRef</code> anywhere in <code>Text.tsx</code>.
            </>
          )}
        </Text>
      </section>
    </main>
  );
}
