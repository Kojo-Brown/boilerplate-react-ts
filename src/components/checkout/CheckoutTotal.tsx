import { memo, useEffect, useRef } from "react";
import { useSelector } from "@xstate/react";
import type { ActorRefFrom } from "xstate";
import { Text } from "@/components/ui/Text";
import { cartTotalMinor, formatMoney } from "@/lib/checkoutApi";
import type { checkoutMachine } from "@/machines/checkoutMachine";

interface CheckoutTotalProps {
  readonly actor: ActorRefFrom<typeof checkoutMachine>;
}

/**
 * The running total, subscribed to the machine rather than passed down.
 *
 * This exists to make one distinction concrete. `useMachine` re-renders its
 * component on every snapshot — every keystroke in the address form is a new
 * snapshot — so a component that only cares about the total would re-render
 * for all of them. `useSelector` subscribes to a *slice* and re-renders only
 * when that slice changes by `Object.is`.
 *
 * The selector therefore has to return something comparable. Returning
 * `{ total }` here would defeat the whole mechanism: a fresh object is never
 * `Object.is`-equal to the last one, so the component would re-render exactly
 * as often as `useMachine` would — silently, and with the extra machinery
 * still in place to suggest otherwise. A number is the right shape.
 *
 * `memo` is the other half, and leaving it off is the mistake worth naming.
 * `useSelector` narrows the *subscription*; it does nothing about the ordinary
 * React rule that a re-rendering parent re-renders its children. This component
 * sits inside `CheckoutFlow`, which re-renders on every snapshot, so without
 * `memo` it would re-render on every keystroke anyway and the selector would be
 * pure decoration. The pair works because `actor` is referentially stable for
 * the life of the machine.
 */
export const CheckoutTotal = memo(function CheckoutTotal({ actor }: CheckoutTotalProps) {
  const totalMinor = useSelector(actor, (snapshot) => cartTotalMinor(snapshot.context.cart));

  const node = useRef<HTMLSpanElement>(null);
  const commits = useRef(0);

  /*
   * The evidence for the paragraph above: a commit counter the lab page and
   * the tests can read.
   *
   * It is written to the DOM from an effect rather than rendered, because a
   * value that must count its own renders cannot be one of them — incrementing
   * during render is a side effect in the render phase, which the React
   * Compiler's lint rules reject and StrictMode's double invocation would
   * double-count. An effect with no dependency array runs after every commit,
   * which is exactly the quantity being measured.
   */
  useEffect(() => {
    commits.current += 1;
    node.current?.setAttribute("data-commits", String(commits.current));
  });

  return (
    <Text
      as="span"
      ref={node}
      weight="semibold"
      className="font-mono"
      data-testid="live-total"
      data-commits="0"
    >
      {formatMoney(totalMinor)}
    </Text>
  );
});
