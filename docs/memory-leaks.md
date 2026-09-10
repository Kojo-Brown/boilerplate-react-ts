# Hunting memory leaks

A single-page application never reloads. Every listener that outlives its
component, every DOM subtree something still points at, and every cache entry
nothing evicts is paid for by the user's next hour, not their next navigation —
and none of it shows up in a unit test, a type error or a bundle budget.

This is the method this repository uses to find that, the gate that keeps it
from coming back, and what the gate found the first time it was run.

- The audit library: `tooling/memoryAudit/`
- The gate: `e2e/memory-leak.spec.ts`, which runs in CI as part of the **E2E
  Tests** job

Run it locally with:

```bash
pnpm test:e2e --project=chromium memory-leak
```

---

## The method

### 1. Pick a journey that ends where it started

A leak is something a _repeated_ action leaves behind, so the measurement needs
an action that can be repeated and a state it returns to. "Navigate to About
and back to Home" qualifies. "Scroll the infinite feed" does not — it is
supposed to accumulate.

It must also be a **client-side** journey. `page.goto` tears down the document,
which frees everything whether the application would have or not, so a test
built on it measures Chrome and not your code.

### 2. Warm up once, and throw that measurement away

The first pass allocates things that are per-application, not per-iteration:
the route chunk, the query cache, compiled regexes, fonts, the router's history
entries. All of it looks exactly like a leak in a before/after pair that starts
from a cold page, and none of it is one.

### 3. Sample, repeat _N_ times, sample again — collecting garbage first

`HeapProfiler.collectGarbage` over CDP, then `HeapProfiler.takeHeapSnapshot`.
Without the forced collection you are counting objects that were merely _not
yet_ collected, which varies between runs and makes the gate fail at random.

Note that `takeHeapSnapshot` does not return the snapshot: it streams it as
`HeapProfiler.addHeapSnapshotChunk` events and resolves once the last one is
out. Subscribe **before** you send the command — this is the single commonest
way this measurement silently reports an empty heap.

### 4. Judge the growth per iteration, never the absolute count

A freshly loaded page has detached nodes in it. React's reconciliation,
Chromium's style and font machinery and any devtools you have mounted all hold
a handful, and the number moves between Chrome versions.

A gate that asserts _zero_ fails on correct code, gets `+ 20` of slack added to
it within a week, and never fails again. So:

```
growth per iteration = (after − baseline) / iterations
```

Everything one-off cancels out, and what is left is the thing a leak actually
is. See `tooling/memoryAudit/leakVerdict.ts`.

**Unless the journey's measurement has a quantum bigger than the rate.** Some
journeys strand a whole subtree behind a bounded one-off retainer, and whether
one or two such retainers are populated at a given sample is not something the
test controls — so the count steps by tens of nodes between samples that are
both correct. A rate ceiling there measures the browser's bookkeeping and fails
at random. Those journeys set `maxDetachedNodesPerIteration: null` and a
`maxDetachedNodes` ceiling instead, which asserts what they can actually claim:
the population is bounded, far below what one stranded subtree per iteration
would reach. The popup journey is the worked example — see
[what the first run found](#which-is-why-the-popup-journey-is-judged-by-an-absolute-ceiling).

### 5. Count listeners directly, rather than inferring them

A heap snapshot tells you _that_ nodes are detached. It is much worse at
telling you _why_, because the commonest cause — a listener on something
long-lived closing over something short-lived — appears in the retainer path as
an anonymous `context` edge under a `system / Context`.

`tooling/memoryAudit/listenerProbe.ts` wraps `addEventListener` /
`removeEventListener` at document start and keeps a census of what has been
registered and not removed. That turns "something is retaining the dashboard"
into "three `resize` listeners on `window` that nothing removed", and it gives
the audit its sharpest signal: **a listener still bound to a node that is no
longer in the document**. There is no benign reason for one — either a teardown
did not run, or the node is uncollectable _because_ of it — so the ceiling for
that metric is 0 rather than a rate.

Two deliberate limitations:

- `{ once: true }` listeners are not counted. The DOM removes them itself
  without going through `removeEventListener`, so counting them would report
  every fired one-shot as a leak forever. Under-counting something guaranteed
  to remove itself is the safe direction.
- Targets are held in `WeakRef`s. A probe that held them strongly would keep
  every node it ever saw alive and then report the heap it had created.

`getEventListeners()` was not used: it is a DevTools _console_ helper with no
CDP command behind it, so an audit built on it can only be run by a human with
the inspector open.

### 6. Make the failure message the diagnosis

`expected 231 to be less than 20` tells a reader nothing about whether they are
looking at a real leak or a flaky measurement, and a memory gate that cannot be
distinguished from a flaky one gets switched off.

Every failure here prints the verdict table, the detached population grouped by
tag, the listener registrations that moved, and the **shortest retaining path**
from a GC root to one of the leaked nodes — the same chain DevTools shows in
its retainers pane:

```
Shortest retaining path to one <span>:
  (root) [synthetic] --shortcut 2-->
   Window / http://localhost:3000 [object] --property __leakStore__-->
    Array [object] --element 9-->
     <div class="leak-host"> [native] --element 4-->
```

`__leakStore__` is the line of code to go and delete. "It is reachable from
`Window`" — which is what a shorter report would have said — is true of
everything on the page.

Weak edges are skipped when searching. A weak reference is by construction not
what is keeping something alive, and following one is the commonest way a
hand-rolled retainer search names the wrong culprit.

### 7. Prove the gate can fail

`e2e/memory-leak.spec.ts` contains a test that plants a leak of a known size —
a module-scope array holding removed subtrees, each with 20 click handlers —
and asserts that the audit catches it, that the listener census sees all 200
handlers on detached nodes, and that the retainer path names `__leakStore__`.

It was written first. A green memory gate and a memory gate that measures
nothing both print "no leak", and this is the only thing that tells them apart.

---

## Reading a heap snapshot

`tooling/memoryAudit/heapSnapshot.ts` is a reader for V8's format, which is
three flat arrays rather than a tree:

| array     | shape                                                                       |
| --------- | --------------------------------------------------------------------------- |
| `nodes`   | `node_fields.length` numbers per node, in one flat array                    |
| `edges`   | `edge_fields.length` numbers per edge; node _i_'s edges follow node _i-1_'s |
| `strings` | every name, deduplicated; nodes carry an index into it                      |

Four details are worth knowing before writing anything against it, because each
one produces a plausible-looking wrong answer rather than an error:

- **`to_node` is a flat offset, not an ordinal.** Divide by
  `node_fields.length`.
- **A node stores its edge _count_, not its edge _offset_.** Where node _i_'s
  edges begin is the sum of every count before it.
- **`element` and `hidden` edges carry a number where every other edge type
  carries a string index.** Reading one through the string table returns a real
  name belonging to something else entirely.
- **"Detached" has two independent signals.** The `detachedness` column (0
  unknown, 1 attached, 2 detached) and the `Detached ` name prefix that
  DevTools displays. Neither is a superset of the other, so the audit takes the
  union — that is what makes its count reconcilable with what a human sees in
  the DevTools "Detached elements" panel.

One presentation note: Chrome names an element node with its whole opening tag,
attributes included, so with Tailwind a single `<div>` arrives as a
two-hundred-character name and two divs differing by one utility class look
like two different classes of object. The audit groups by tag and keeps the
full name on the node for the report.

---

## What the first run found

**Nothing accumulates.** Zero listener growth on both journeys, nothing left
bound to a detached node, and zero detached-node growth across navigation.
Nothing in this application leaks across navigation or across opening and
closing a popup.

Three things turned up that are worth writing down, because the next person to
run this will see them and wonder.

### One detached listbox subtree per mounted `SelectMenu`

26 nodes: a `<ul>`, 12 `<li>`, 13 `<span>`. Closing the popup unmounts it, and
it stays reachable through the trigger's fiber:

```
<button aria-haspopup="listbox"> --property __reactFiber$…-->
 FiberNode --property pendingProps--> Object --property onClick-->
  onClick [closure] --internal context--> system / Context --context listElement-->
   <ul role="listbox">
```

React double-buffers its fiber tree, and the alternate fiber holds the previous
render's props. Those props include the trigger's `onClick`, whose closure scope
is that render — and that render's `listElement` was the open popup's `<ul>`.
It is bounded: the alternate is reused, so the _next_ render overwrites it, and
ten cycles leave the same one subtree as one cycle does. Nothing the component
can do reaches it either — nulling the state out on close does not touch a
closure that already captured the old value. Recorded, not fixed.

### The last event object retains its target

Dismissing the popup with Escape leaves V8 holding that `KeyboardEvent` in an
internal cache, and its `target` is the `<ul>` that has just been unmounted:

```
system / NativeContext --internal slow_template_instantiations_cache-->
 … --internal getter--> get [closure] --internal context-->
  system / Context --context e--> KeyboardEvent --property target-->
   <ul role="listbox">
```

Also bounded — there is only ever one last event — and also nothing the
application can influence.

### Which is why the popup journey is judged by an absolute ceiling

Those two retainers are each one popup subtree, and **whether they point at the
same subtree or two different ones is not something the journey controls**. So
the detached count on that journey steps between one and two quanta of 26
nodes, i.e. ±2.6 per iteration over a ten-iteration window — against a rate
ceiling of 1.

The first CI run of this gate failed on exactly that, at 29 → 55 nodes, and it
was right to: a per-iteration rate is not a claim that journey can make. What it
_can_ claim is that the population is **bounded**, so it is judged against an
absolute ceiling of four subtrees, against the eleven (~290 nodes) that one
stranded popup per open would produce. `maxDetachedNodesPerIteration: null` plus
`maxDetachedNodes` is how a policy says so.

The listener half of that journey needs no such allowance and gets none:
`SelectMenu` binds `pointerdown` on `document` for exactly as long as it is
open, so a missing cleanup is +1 listener per iteration. Checked by deleting
that cleanup and re-running — `Live event listeners` goes 168 → 178 over ten
iterations, 1.00 per iteration against a ceiling of 0, and the gate is red,
while **the detached-node row does not move at all**, because the stranded
listeners sit on `document`, which is attached. That is the assertion doing the
work on this journey, and it is the whole argument for counting registrations
rather than inferring them from the heap.

### Two `<div>`s and an `SVGSVGElement` behind the TanStack Query devtools button

Development-only — the devtools are not in a production build — and
third-party. Recorded, not fixed.

---

## When the gate goes red

1. **Read the failure message before reproducing anything.** The detached
   population and the retainer path are already there.
2. **Check the listener rows.** If listeners grew at the same rate as nodes,
   the leak is a missing `removeEventListener` and the census names the target
   and the event type.
3. **If only nodes grew,** something non-DOM is holding a subtree: a cache
   keyed by something unbounded, a closure in a timer, a promise nobody
   settles, a ref that outlives its component.
4. **Reproduce in DevTools** — Memory → _Take heap snapshot_, filter for
   `Detached` — and compare against what the gate said. If the two disagree,
   the audit is wrong and that is the bug to fix first.

Never raise a threshold to get back to green. The ceilings here are 1 detached
node and 0 listeners per iteration; a change that needs them raised is a change
that has started retaining something per interaction, which is the thing this
document exists to catch.
