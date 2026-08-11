# React Compiler

The React Compiler is enabled in **`annotation` mode**: it rewrites a function
only when that function opts in with a `"use memo"` directive. Everything else
is emitted exactly as written.

That is the whole point. Turning the compiler on across 78 test files' worth of
behaviour in one commit gives you no way to attribute a regression, and no way
to say which of the memoizations you deleted were actually replaced. Annotation
mode makes adoption a sequence of small, individually verifiable steps.

## Where it is configured

`reactCompiler.config.ts` is the single source of truth. Four consumers read it
and they have to agree:

| Consumer                              | Why it needs the same config                     |
| ------------------------------------- | ------------------------------------------------ |
| `vite.config.ts`                      | Compiles the production bundle.                  |
| `vitest.config.ts`                    | Compiles the code the unit suite runs.           |
| `eslint.config.ts`                    | The lint rules _are_ the compiler's diagnostics. |
| `tooling/reactCompiler.audit.test.ts` | Asserts the opted-in functions actually compile. |

The Vitest entry is the one worth pausing on. Before this change the unit suite
transformed JSX with esbuild and loaded **no Vite plugins**, which meant tests
ran uncompiled source. Every "it was safe to delete this `useMemo`" claim below
would have been unfalsifiable: the tests would have exercised code where the
memoization was simply gone. Tests now run through the same compiler the
browser gets, and the stability assertions added with this change fail without
it — verified by removing each directive and watching the specific test go red.

React 19 ships the compiler runtime inside the `react` package, so there is no
`react-compiler-runtime` dependency.

## The lint rules

`eslint-plugin-react-hooks` v7 (upgraded from v5) ships the compiler's own
diagnostics as lint rules — the standalone `eslint-plugin-react-compiler`
package was folded into it. The config uses
`reactHooks.configs.flat["recommended-latest"]`, which is 17 rules including
`immutability`, `purity`, `refs`, `set-state-in-render`, `static-components` and
`preserve-manual-memoization`.

These are not a style preference. They are the mechanism that makes this rollout
safe rather than hopeful:

- A component that lints clean is one the compiler can memoize. That is the
  entry condition for opting a file in.
- A component that does not lint clean is reporting a **real Rules of React
  violation** — a bug with or without the compiler. The compiler just makes it
  cost something.

Running the full rule set across this codebase for the first time produced
exactly two findings, both real. They are covered below.

## Opting a file in

1. Confirm the file lints clean under the `react-hooks` rules.
2. Add `"use memo"` as the first statement of the function.
3. Delete the manual memoization the compiler now subsumes.
4. **Add a test asserting the memoization still exists** — referential
   stability across a re-render that changes nothing, and a new reference when
   an input does change. Without step 4 you have swapped a guarantee you could
   read for one you are trusting.
5. Add the file to `OPTED_IN` in `tooling/reactCompiler.audit.test.ts` and add
   a row to the table below.

Steps 4 and 5 are enforced. `pnpm test` fails if a `"use memo"` directive exists
in a file that is not in `OPTED_IN`, and fails if an opted-in function does not
actually compile.

### Why the audit gate exists

**A failed compile is silent.** If the compiler cannot handle an annotated
function, it logs a `CompileError` and emits the function unchanged. The build
still succeeds and nothing turns red. So a file can carry `"use memo"`, have had
its `useMemo` deleted on the strength of that directive, and ship unmemoized
with no signal anywhere.

`reactCompiler.audit.test.ts` runs the real compiler over the source and asserts
on its log events: every opted-in function must produce `CompileSuccess`, no
file may produce `CompileError`, and — proving `annotation` mode is doing what
it claims — no un-annotated file may produce `CompileSuccess` at all.

## The memo-removal audit

Every hand-written memoization in `src/`, with a verdict.

### Removed

| Site                              | What came out                                              | Why it was safe                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks/useFilteredSortedItems.ts` | `useMemo` around the whole body                            | Pure derivation from five arguments. The compiler infers the same dependency set from the code, which removes the manual version's failure mode: a dependency array that drifts from the body and serves stale results. |
| `context/ThemeContext.tsx`        | `useCallback` on `setMode`, `useMemo` on the context value | A provider's context value is where identity matters most — a new object re-renders every consumer.                                                                                                                     |
| `components/ui/Toast.tsx`         | `useCallback` on `toast` and `dismiss`                     | See below; these two were already achieving nothing.                                                                                                                                                                    |

Each removal is covered by a stability test in the file's existing suite
(`useFilteredSortedItems.test.ts`, `ThemeContext.test.tsx`, `Toast.test.tsx`).

**`ToastProvider` is the clearest case for the compiler in this codebase.**
`toast` and `dismiss` were each wrapped in `useCallback` — and then handed to
consumers as `value={{ toast, dismiss }}`, a fresh object literal on every
render. Consumers compare the object, not the functions inside it, so the
context value changed identity every single render and both `useCallback`s
bought exactly nothing. Two correct-looking memoizations, zero effect, and
nothing in the type system or the old lint config to say so. The compiler
memoizes the object literal along with the functions.

### Kept, deliberately

| Site                                                                                                        | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/performance/MemoizedList.tsx` (`memo`, `useCallback`, `useMemo`)                                | This component **is** the manual-memoization reference — a `memo` with a custom comparator, a stable handler, and a derived list. Compiling it away would delete the lesson. It stays as the worked example of what the compiler does for you.                                                                                                                                                                         |
| `components/performance/ConcurrentFilterList.tsx` (`memo` ×2, `useMemo`)                                    | The `memo` boundary around `<ResultRows>` was **measured** load-bearing in PR #19: without it a keystroke still reconciles 15,000 rows and deferring buys almost nothing (256ms vs 824ms worst keypress-to-paint with it, 840ms vs 1232ms without). Whether the compiler's memoization substitutes for that boundary is an empirical question, and the benchmark is how to answer it — not an assumption to make here. |
| `components/performance/VirtualList.tsx`                                                                    | Not memoized by hand, and deliberately **not** opted in: `react-hooks/incompatible-library` reports that TanStack Virtual's `useVirtualizer()` returns functions the compiler cannot memoize without risking stale UI, so it would skip this component anyway. The rule is suppressed at that call with a comment; annotation mode means the risk cannot arise while the file is uncompiled.                           |
| `pages/*LabPage.tsx` (`useMemo` ×4)                                                                         | These build in-memory API instances and seeded datasets whose **identity is load-bearing** — a new instance would reset the lab's state mid-session. That is memoization for correctness, which React explicitly does not guarantee for `useMemo`; the right fix is `useState(() => …)`, not a compiler directive. Out of scope here, and opting them in would not be a memo _removal_.                                |
| `hooks/useLocalStorage.ts`, `hooks/useOptimisticList.ts`, `hooks/useGlobalQueryError.ts` (`useCallback` ×5) | Straightforward removal candidates with no complications. Left for the next cohort so this change stays reviewable; each still needs its own stability test.                                                                                                                                                                                                                                                           |

### `useStableCallback` — the one real violation

`react-hooks/refs` flagged `hooks/useStableCallback.ts` for writing
`fnRef.current = fn` during render. That is a genuine Rules of React violation,
not a false positive: it makes the render impure, and under `<StrictMode>` or a
re-render React discards, the ref keeps a write from a render that never
committed.

The fix moves the write into a `useLayoutEffect` — the layout phase
specifically, because it flushes after commit but before paint, so no user event
can reach the callback while the ref is stale. A passive `useEffect` would leave
that window open.

**Why not `useEffectEvent`?** React 19.2 ships it, and it is the first-class
version of this pattern — but it cannot implement this hook.
`react-hooks/rules-of-hooks` rejects returning an Effect Event from a custom
hook:

> React Hook "useEffectEvent" can only be called at the top level of your
> component. It cannot be passed down.

That restriction is the feature: Effect Events are not values that travel. So
prefer `useEffectEvent` directly inside a component; reach for
`useStableCallback` when a shared abstraction has to produce the stable
callback.

The correctness fix costs one thing, and it is now pinned by a test rather than
left as a surprise: between render and the layout effect, the callback still
sees the previous `fn`. Calling it during render is unsupported — which it
already was.

## What is not done yet

- The second cohort (`useLocalStorage`, `useOptimisticList`,
  `useGlobalQueryError`) is identified but not opted in.
- Whether the compiler's memoization can replace the measured `memo` boundary in
  `ConcurrentFilterList` is unanswered. Re-running the PR #19 jank benchmark
  with the component annotated is the way to settle it.
- Moving from `annotation` to `infer` mode — compiling everything the compiler
  judges to be a component or hook — is the end state. It is gated on the
  cohorts above, since `infer` mode compiles every file at once and gives up the
  per-file attribution this setup is built around.
