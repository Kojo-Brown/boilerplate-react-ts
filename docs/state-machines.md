# State machines with XState

The checkout at `/labs/checkout` is four steps, one actor, and a set of rules
that are enforced by the _shape_ of the machine rather than by code that
remembers to check them.

- Machine: `src/machines/checkoutMachine.ts`
- Domain and fake server: `src/lib/checkoutApi.ts`
- Validation: `src/lib/checkoutSchemas.ts`
- React binding: `src/components/checkout/CheckoutFlow.tsx`
- Lab page: `src/pages/CheckoutLabPage.tsx`

## Why a machine, and when not

A multi-step form does not need a machine because it has steps. It needs one
when the flow has invariants, because an invariant expressed as a state machine
cannot be violated by a code path that forgot about it.

Three of them here:

| Invariant                              | How the machine says it                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| You cannot pay for an empty basket     | `next` has no eligible transition out of `cart` when it is empty             |
| You cannot submit the same order twice | `submitting` declares no `order.place` transition                            |
| Leaving mid-submit cancels the request | Exiting `submitting` stops the invoked actor, which aborts its `AbortSignal` |

Compare each with the `useState` version. The first becomes `disabled={cart.length === 0}`
on one button — correct until a second entry point appears. The second becomes
`const [submitting, setSubmitting] = useState(false)`, correct until a code path
forgets to unset it, at which point the checkout is permanently dead with no
error anywhere. The third is usually not implemented at all.

If your flow has none of those — a wizard whose steps are independent and whose
submit is idempotent — `useState` is the right answer and a machine is
ceremony.

## The things that were not obvious

### A guard on its own produces a dead button

XState **drops** an event with no eligible transition. No error, no snapshot
change, nothing in the devtools timeline. So this:

```ts
next: { guard: "shippingValid", target: "payment" }
```

gives a Continue button that does nothing at all when the form is invalid — no
message, no focus move, nothing for the user to chase and nothing for you to
debug. Every guarded step here therefore has a second, unguarded transition
underneath it whose only job is to record why the first one was refused:

```ts
next: [
  { guard: "shippingValid", target: "payment", actions: "applyShippingParse" },
  { actions: "applyShippingParse" },
],
```

Both transitions run the _same_ action. Splitting it into a `commitShipping`
and a `showShippingErrors` reads better and is worse: each half then carries a
branch for the case the guard already ruled out — dead code no test can reach,
which quietly becomes wrong the day the guard changes.

Order matters and is not enforced by anything: transitions are evaluated in
array order, so a catch-all placed first wins every time and the guard becomes
unreachable.

### A guard cannot write to context, so the parse happens twice

`shippingValid` parses the draft to decide the transition; `applyShippingParse`
parses it again to store the result or the errors. That is intrinsic rather than
sloppy — a guard is a predicate, and choosing the target is the one thing an
action cannot do. Caching the parse in context would add a slot that can go
stale; paying for a four-field Zod parse twice would not.

### Entry actions run _after_ the transition's actions

A `clearMessage` on each step's `entry` looks like the tidy way to reset
per-step state. It would silently erase the server rejection that routed the
user back to that step, because the transition's own action sets the message
first and the entry action runs afterwards. Clearing is therefore explicit, on
the transitions where clearing is correct.

### `confirmed` is not a final state

A final root state stops the actor, and a stopped actor cannot be restarted —
`actor.start()` on one is a no-op. "Start another order" would then require the
page to throw the machine away and build a new one. The _flow_ ends at
confirmation; the actor modelling it does not.

### There are no typestates in v5

XState v4's typestates were removed in v5. A snapshot in `review` is not a type
that knows `context.shipping` is non-null, even though `review` is the only
place that sets it. The honest options are a non-null assertion at the `invoke`
or a function that narrows once — `toCheckoutInput()` here, guarded by
`detailsComplete`, so the impossible branch is a real branch a test can cover
rather than an assertion nobody can check.

### `input` is a function for a reason

```ts
input: ({ context }) => ({ api: context.api, input: toCheckoutInput(context) }),
```

Read at invoke time, not at machine-build time. An edit made in review before
pressing Place order is in the request precisely because of this; a value
closed over when the machine was created would not be.

### A server rejection can belong to a step

`CheckoutRejectedError` carries `step` and `retryable`, and the machine routes
on both. A declined card lands back on the payment step with the message
attached, not on an error screen offering a Try again that would decline
identically. A gateway timeout belongs to no step, so it lands on the failure
state, which is the only place Try again is offered — and `order.retry` is
guarded on `retryable`, so the button is not rendered when it could not work.

## The React binding

`CheckoutFlow` is the only component that knows a machine exists. Every step
takes values and callbacks, which is what lets each one be tested without an
actor.

### `useMachine` reads `input` once

Changing the `api` prop afterwards does nothing, with no warning. The lab page
handles that with a `key` that remounts the flow when the server knobs change.
Any caller swapping the API at runtime has to do the same.

### `useSelector` narrows the subscription; `memo` narrows the render

`CheckoutTotal` subscribes to one slice with `useSelector`, so a snapshot that
does not move the cart total does not notify it. That alone is not enough: it
sits inside `CheckoutFlow`, which re-renders on every keystroke, and a
re-rendering parent re-renders its children whatever they subscribe to. Both
halves are needed, and `memo` works here only because `actor` is referentially
stable.

The selector must also return something `Object.is` can compare. Returning
`{ total }` would make every notification a change and quietly restore the
behaviour the hook was added to avoid.

## Testing

The machine is tested as an actor, with no DOM:
`src/machines/checkoutMachine.test.ts` drives `createActor(checkoutMachine)`
directly. That is the payoff of keeping the logic out of components — the
double-submit rule, the abort-on-cancel rule and the rejection routing are all
assertions about a value, not about a rendering.

The browser arm (`e2e/checkout-machine.spec.ts`) covers the two claims jsdom
cannot make: a real `dblclick` is one gesture rather than two awaited ones, and
the pending state is a layout in which Cancel has to be genuinely clickable.

## Not done

- The machine is not persisted. XState can serialise a snapshot
  (`actor.getPersistedSnapshot()`) and restore it, which would survive a reload
  mid-checkout, but restoring into `submitting` needs a decision about whether
  the order was actually placed — an idempotency key on the server, not a
  client-side change — so it is out of scope here.
- There is no `@statelyai/inspect` wiring. It is a devDependency and a
  three-line `inspect` option away, but it opens a websocket to an external
  service, which is not something to add to a boilerplate by default.
