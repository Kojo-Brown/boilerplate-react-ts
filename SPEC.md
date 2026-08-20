# Spec: boilerplate-react-ts

> Spec-driven. One item per run, PR-driven. Do not skip items. Mark `[x]` only after the PR merges.

## Phase 0 — Green Baseline (blocks all feature work)

- [x] Fix the 10 remaining test failures: Toast auto-dismiss timeouts (needs fake timers), duplicate-text queries in Sidebar/RootLayout, ThemeContext localStorage persistence, NotFoundPage copy drift, router `/about` + `/dashboard` assertions
- [x] Restore `.github/workflows/ci.yml` from `workflow-templates/` now that the token has `workflow` scope, and confirm it runs green on a PR
- [x] Add `pnpm build` to CI and fix any production-build-only failures
- [x] Verify Playwright E2E actually runs (`pnpm test:e2e`) and wire it into CI — required committing the missing `public/mockServiceWorker.js`, disabling MSW during E2E (`VITE_DISABLE_MSW`) so `page.route()` owns the network, making skeleton bars `aria-hidden` (their `role="status"` labels collided with real controls' accessible names), and pinning CI to `--project=chromium`

Phase 0 complete as of PR #18 (2026-07-28): install, typecheck, lint, format,
454 unit tests, 19 E2E tests, and build all green in CI.

## Phase 1 — Foundation

- [x] Vite 7 + React 19 + TypeScript 6 scaffold with strict tsconfig
- [x] TailwindCSS 4 with CSS variables design token system
- [x] ESLint 9 + Prettier + Husky pre-commit hooks
- [x] Absolute imports via `@/` alias (vite + tsconfig)
- [x] Environment variable typing with `src/env.ts`

## Phase 2 — State & Data

- [x] Redux Toolkit 2 store with RTK Query + typed hooks
- [x] TanStack Query 5 setup with QueryClient + Devtools + global error handler
- [x] Zustand slice pattern (lightweight local state alternative)
- [x] React Hook Form 8 + Zod 4 validation with reusable `<FormField>`

## Phase 3 — Routing & Layout

- [x] React Router 7 with typed routes, lazy loading, and ScrollRestoration
- [x] Root layout with Navbar, Sidebar, and `<Outlet>`
- [x] Protected route wrapper (auth guard) + redirect logic
- [x] 404 / error boundary pages with retry

## Phase 4 — Auth

- [x] JWT auth flow: login, logout, token refresh, silent refresh
- [x] OAuth 2.0 PKCE flow (Google provider example)
- [x] Auth context + `useAuth` hook with role-based access
- [x] Persistent session via `localStorage` with expiry check

## Phase 5 — UI System

- [x] Design token CSS variables (colors, spacing, radius, shadows)
- [x] Component library: Button, Input, Modal, Toast, Spinner, Badge
- [x] Dark mode toggle with `prefers-color-scheme` default
- [x] Responsive layout primitives: Container, Grid, Stack, Divider

## Phase 6 — Performance

- [x] Code splitting per route + `React.lazy` + `<Suspense>` skeletons
- [x] Image optimization wrapper with lazy loading + blur placeholder
- [x] Memoization patterns: `useMemo`, `useCallback`, `memo` examples
- [x] Virtual list example with TanStack Virtual

## Phase 7 — Testing

- [x] Vitest + Testing Library setup with `setup.ts` and MSW mocks
- [x] Playwright E2E: login flow, protected route, API mock
- [x] Component snapshot tests for UI system
- [x] Coverage thresholds in `vitest.config.ts`

## Phase 8 — DevOps

- [x] GitHub Actions: lint → test → build → preview deploy
- [x] Dockerfile (multi-stage, nginx, non-root user)
- [x] `.env.example` with all required vars documented
- [x] Bundle analysis script (`rollup-plugin-visualizer`)

## Phase 9 — React 19 Concurrency

- [x] `useTransition` + `useDeferredValue` on a heavy filterable list, with a jank before/after benchmark — `<ConcurrentFilterList>` plus a `/labs/concurrency` harness and a Playwright benchmark that drives both arms. The memo boundary around the rows turned out to be load-bearing: without it the urgent render still reconciles every row and deferring buys almost nothing (840ms vs 1232ms worst keypress-to-paint, against 256ms vs 824ms with it). The benchmark is what caught that (PR #19)
- [x] `useOptimistic` mutations with automatic rollback on failure — `useOptimisticList` plus `<OptimisticTaskList>` and a `/labs/optimistic` harness whose fake server fails on demand from the URL. Nothing undoes an optimistic action: the rollback is the _absence_ of a commit, so both layers run through one reducer and a rejected request simply never reaches committed state. Three React 19 behaviours were not obvious and are now pinned by tests — the `await` must stay inside the transition; ordinary state set synchronously inside an async transition never renders on its own (clearing the error there left a stale banner up through the next request _and_ kept the optimistic layer alive past its settle point, which is what three failing tests were actually reporting); and optimistic actions unwind as a group, so an overlapping failed mutation's row lingers until the last in-flight action settles (PR #20)
- [x] `use()` API for unwrapping promises and context inside Suspense boundaries — `<UserProfileCard>` reads data with `use(cache.read(id))` and its cache with `cache ?? use(ProfileCacheContext)`, the conditional read no other hook-shaped API allows; `<ProfilePanel>` supplies the two boundaries `use()` needs, per profile, and `/labs/use` drives both against a fake service configured from the URL. Four things were not obvious: a promise created during render suspends forever, so `createPromiseCache` is the precondition rather than an optimisation; a rejected entry has to be sticky, because dropping it hands the retry a fresh _pending_ promise and the tree falls back forever instead of surfacing the error (so retry is `invalidate` then reset — reset alone visibly does nothing); replacing the cache in place is an update, and React Router runs navigations in a transition that holds the previous UI, so the lab remounts on a `key` instead; and a cached rejection nobody reads is an unhandled rejection. Testing Library's `render` wraps the first render in a _synchronous_ `act()`, which strands a `use()` retry and leaves the fallback up until `waitFor` times out — `lazy()` never hit it — so `src/test/renderSuspense.tsx` adds `renderAsync`/`actAsync` (PR #21)
- [x] Actions API: `useActionState` + `useFormStatus` replacing manual form submit state — `<InviteTeammateForm>` keeps no submit state of its own (no `isSubmitting`, no `setError`, no `try/finally` resetting a flag), with `src/lib/formState.ts` as the reusable half: one `FormState<Field>` shape that a schema failure and a server rejection both resolve to, so the form renders one thing instead of branching on where the problem came from. `InviteRejectedError.field` decides whether a message belongs under a control or at the top of the form, so that judgement is made by the side that can make it. Three React 19 behaviours were not obvious and are now pinned by tests: React resets the form once the action settles, which is right for a success and hostile on a failure — the action echoes the submitted values back and the controls read `defaultValue` from there, so the reset restores what was typed rather than wiping it; `<select>` is the one control that echo does not reach, because React keeps an input's and textarea's `defaultValue` in sync after mount but never propagates a changed one onto a mounted select's options, so the reset restores the option selected at _mount_ and the choice disappears silently on the failure path only (found by a failing test, fixed by keying the select on the echoed value); and `useFormStatus` reports only to descendants of the `<form>`, so calling it in the component that renders the form returns `pending: false` forever with no warning — hence `<SubmitButton>` and `<SubmittingNotice>` as separate components, with the button's test asserting the idle reading from outside the form. Focus moves to the first invalid control keyed on the state object, since narrowing that dependency to `state.status` breaks the second identical submission. `/labs/actions` drives it against a fake service configured from the URL. 731 tests across 78 files, all six checks green (PR #22)
- [x] React Compiler enabled incrementally with an ESLint rule and a memo-removal audit — `annotation` mode, so a function is compiled only where it opts in with `"use memo"`; `reactCompiler.config.ts` is the one object Vite, Vitest, ESLint and the audit gate all read. Vitest previously loaded no Vite plugins at all, so the unit suite ran _uncompiled_ source — every "safe to delete this `useMemo`" claim would have been unfalsifiable, and each stability test added here was checked to fail with its directive removed. `eslint-plugin-react-hooks` 5→7 brings the compiler's own 17 diagnostics in as lint rules; run across the codebase for the first time they found exactly two real things: `useStableCallback` wrote a ref during render (fixed in a `useLayoutEffect` — it cannot be rebuilt on React 19.2's `useEffectEvent`, which is rejected outright when returned from a custom hook), and TanStack Virtual makes `VirtualList` uncompilable, which is why it is deliberately outside the cohort. `ToastProvider` is the clearest case for the compiler: `toast` and `dismiss` were each wrapped in `useCallback` and then passed inside a fresh `{{ toast, dismiss }}` literal every render, so consumers compared a new object every time and both memoizations achieved nothing. The audit gate exists because a failed compile is _silent_ — the compiler logs a `CompileError` and emits the function unchanged while the build stays green — so `tooling/reactCompiler.audit.test.ts` asserts every opted-in function reaches `CompileSuccess` and that no un-annotated file is compiled at all. 742 tests across 79 files; `useMemoCache` present in the production bundle (PR #23)
- [x] Suspense-driven data fetching with streaming boundaries and nested fallbacks — `SectionBoundary` (a Suspense boundary and the error boundary that has to be outside it) plus `createSectionCache`, a promise cache for a page of differently-typed sections so `read("breakdown")` stays `Promise<BreakdownRow[]>` rather than a union every component then narrows. `/labs/streaming` renders one report under all four combinations of boundary layout × prefetching, with a live request timeline. Boundary placement was expected to be purely a display concern and is not: a suspension abandons the render pass it happened in, so under a single boundary the breakdown suspending means the activity feed never renders and therefore never requests — three round trips in series where nesting a boundary per sibling gives two, and prefetching above the shell's boundary gives one. That claim is measured (`wereConcurrent` over a recorded event timeline), not assumed. Three more behaviours are pinned because they are easy to get backwards: a nested fallback is a sequence rather than a stack (nothing inside an unresolved boundary has rendered, so the inner boundaries do not exist yet); sibling boundaries reveal in completion order, not source order, with no stable way to hold a fast one back since `<SuspenseList>` is still experimental; and a flat boundary's retry has to invalidate every section it stands in front of, or the reset renders the shell straight back over a still-rejected entry and rethrows in the same frame. Tests state their ordering instead of arranging it — `createDeferredReportApi` settles only when the test says so — after the first latency-based draft failed four assertions on its first loaded run. The same race then failed CI in the pre-existing `UserProfileCard`/`ProfilePanel` fallback tests, which are converted to a gate here rather than given a wider timer. 825 tests across 91 files (PR #24)
- [x] `startTransition` for route changes to keep the old UI interactive during navigation — the transition was already there: react-router 7.18 wraps its own state updates in `React.startTransition`, so every `<Link>` click always was one and adding another around `navigate()` changes nothing. What decides whether the previous page survives is where the Suspense boundary is. A transition preserves already-revealed content, and "already revealed" belongs to a boundary _instance_ — a boundary first mounted by this navigation has nothing revealed in it, so React commits its fallback immediately. Every route carried its own boundary, which made the outcome depend on whether React happened to reconcile two route elements onto the same one: `/` ↔ `/about` shared an instance and held; `/dashboard` behind `<ProtectedRoute>` and the `*` fallback did not and flashed. Nothing in the route config showed which. `RootLayout` now holds one boundary above `<Outlet>` and the routes under `/` carry none; `RouteFallback` picks the skeleton by pathname, so hoisting does not cost the per-route skeletons, and reading `useLocation()` there is sound because a fallback only renders when the boundary is new — during an in-app navigation it never renders at all. Two behaviours were not obvious and are pinned against React and React Router directly: the `await` in `startTransition(async () => { await navigate(to) })` is load-bearing and its absence is _silent_ — `navigate` returns before the router touches React state, so the sync form's scope has closed by the time the update lands and `isPending` is never true; with lazy-only routes it still navigates and still holds, so the only symptom is a progress bar that never appears, and adding a loader to any route is what makes it bite. And `useNavigation()` cannot drive that bar at all: it tracks loaders, and a `React.lazy` chunk is not one, so it reads `idle` for the entire download — `<NavLink>`'s `isPending` has the same source, hence `isPendingTarget` beside it rather than shadowing it. Holding is not shippable alone: a click on a slow route otherwise produces no visible change whatsoever, which reads as the app having ignored it, so `RoutePendingBar` is the other half rather than decoration. `/labs/navigation` drives both boundary placements against a deliberately slow route, with a click counter because a held page and a hung page are identical in a screenshot. 909 tests across 99 files, 24 Playwright tests including an arm asserting the per-route boundary still loses the page, all six checks green (PR #25)

## Phase 10 — Advanced Patterns & Architecture

- [x] Compound components with context: `<Tabs><Tabs.List><Tabs.Panel>` and a typed slot API — `createTabs<TValue>()` rather than a generic root with statics hung off it, because the statics do not share the root's type parameter: `Tabs.Tab` is a separate function with its own generic and nothing in TypeScript relates it to the instantiation of the JSX element it sits inside, so `<Tabs.Tab value="typoo">` infers `"typoo"` and compiles clean — a tab that matches no panel, selecting a value nothing answers to, with no error at any level. Closing over `TValue` in a factory is what makes the slots share one union; spelling the root's props as a union of the controlled and uncontrolled shapes makes `value` without `onValueChange` and `value` alongside `defaultValue` unwritable in the same move. Six `@ts-expect-error` assertions pin all of it, with `tsc` as their assertion runner — they fail `typecheck` and `build`, not `test`. Three behaviours were not obvious and are pinned by tests: arrow-key order is read from the DOM at keydown rather than from a registry tabs write to on mount, because mount order stops being DOM order the moment a tab is conditional — reveal one mid-row and it appends, so ArrowRight from its left neighbour jumps to the end (`querySelectorAll('[role="tab"]:not(:disabled)')` also gets reordering and disabled-skipping for free); the roving tab stop follows focus rather than selection, since under manual activation the two diverge by design and binding it to the selection silently discards where the user arrowed to, invisible under automatic activation which is why it ships broken; and `aria-controls` is set only on the tab whose panel is actually in the document, since inactive panels unmount by default and setting it everywhere leaves dangling IDREFs (`keepMounted` renders them `hidden` instead, and then every tab's reference resolves). `createTabs` must be called at module scope, and that is not left to discipline — `react-hooks/static-components` rejects a call inside a component and rejected the first draft of the type-assertion block before it ever ran. 930 tests across 100 files, all six checks green (PR #26)
- [x] Headless component pattern: behaviour hooks split from presentation — `useListbox` holds the behaviour (selection, virtual focus, arrow keys, Home/End, typeahead, ARIA) and renders nothing; `OptionList`, `SelectMenu` and the `CardGrid` in `/labs/headless` render it three ways, the last of which is a grid of cards rather than a list at all. `useListbox.test.ts` has no JSX in it and `listboxSkins.test.tsx` runs one behaviour suite against two skins — the split is what makes both possible. Four things about the prop getters were not obvious: spreading one is not merging (`{...getOptionProps(v)} onClick={x}` silently drops the hook's handler and the other order drops the caller's, hence `mergeProps` and getters that take caller props); the opt-out cannot be `event.preventDefault()`, since stopping page scroll under ArrowDown is the commonest thing a caller's key handler does and reading the DOM flag would leave the arrow keys dead with nothing to chase, so `preventHookDefault` is a separate marker in a `WeakSet`; `TBase & TCaller` is unusable as the return type because TypeScript reduces an intersection to `never` on the first conflicting property, making every _other_ prop an error too (`Omit<TBase, keyof TCaller> & TCaller`, with a `Record<never, never>` default so a no-argument call is not `unknown` throughout); and React 19 stops calling a ref callback with `null` once it returns a cleanup, so a merged callback owns unwinding the refs that have none — load-bearing in `SelectMenu`, where the popup's focus ref and the hook's scroll ref share an element. Two listbox behaviours are pinned because they are easy to get backwards: virtual focus is re-derived from the live options every render, or `aria-activedescendant` keeps naming an id that has been filtered out; and Space commits the active option only when no typeahead is in flight, since "New " is how you reach "New York" past "New Hampshire". `aria-activedescendant` never moves real focus so nothing scrolls on its own, and jsdom defines no `scrollIntoView` at all — `e2e/headless-listbox.spec.ts` presses End against an overflowing list in a real browser. Each of those three claims was checked against the failure it names. 1020 tests across 106 files, all six checks green (PR #27)
- [x] Polymorphic `as` prop with full generic type inference — `PolymorphicProps` in `src/lib/polymorphic.ts`, with `Text` (constrained `as`) and `Button` (open `as`) as the two worked examples. The pattern is worth revisiting rather than copying because React 19 removed its hard part: `forwardRef` infers its props parameter once at the call site, so a generic render function handed to it comes back non-generic and `<Box as="a" href>` errors on a valid prop — every library shipped a hand-written generic call signature cast over the result to work around it. With `ref` an ordinary prop, a plain generic function is the component and the cast is gone, not replaced. Three type-level things were not obvious and are pinned by `@ts-expect-error` blocks that `tsc` runs rather than vitest: `Omit<A | B, K>` is built from the keys A and B *share*, so omitting one key from `ComponentPropsWithRef<"a" | "button">` discards both `href` and `disabled` — and a union reaches the parameter from something as ordinary as `as={admin ? "a" : "button"}`, hence `DistributiveOmit`; own props and element props must be joined by subtraction, since `TOwnProps & ComponentPropsWithRef<TElement>` reduces to `never` at the first conflict (`Button`'s `size` against `input`'s numeric `size`) and takes every *other* prop on the tag down with it, the same trap recorded in `mergeProps.ts`; and `as` must be destructured, because React writes an unrecognised lowercase prop straight through and `as` is real on `<link>`, so a forwarded one lands as a literal `as="h2"` with every role, text and style assertion still passing. Making `Button` polymorphic forced an accessibility fix rather than a rename: `loading` is meaningful on every element `as` can name but `disabled` exists on five tags only, and forwarding it emits an anchor carrying `disabled` — written without complaint by React, honoured by no browser — so the link greys out and stays focusable, activatable and navigable. `Button` therefore owns `disabled` and picks the mechanism the element supports, `aria-disabled` plus a click interceptor where the attribute does not exist (which covers the keyboard too, since Enter on a focused anchor dispatches a click). Two claims were checked against the failure they name: the first ref assertion could never have fired, because DOM interfaces are structural and `HTMLHeadingElement` declares only a deprecated `align` that `HTMLInputElement` also has, so the assertion pairs label ← paragraph instead; and `<Button as="input">` throws whether or not children are passed, since the `{loading && <svg />}{children}` slot is always two expressions — recorded as a limitation rather than fixed, because a submit input can hold neither a label nor a spinner. The E2E arm exists because jsdom implements no navigation at all, so a jsdom test passes whether or not `preventDefault` ran; every disabled click there is a `force` click, since Playwright's own actionability check reads `aria-disabled` as not-enabled and would never dispatch an event. 1053 tests across 109 files, 30 Playwright tests, all six checks green (PR #28)
- [ ] Render-prop and HOC patterns documented with their modern-hook equivalents
- [ ] State machines with XState for a multi-step checkout flow
- [ ] Feature-Sliced Design directory refactor with an import-boundary lint rule
- [ ] Dependency inversion: swap the API client via context for tests and Storybook

## Phase 11 — Performance Engineering

- [ ] Web Workers via Comlink for CPU-bound parsing off the main thread
- [ ] Windowed infinite scroll with TanStack Virtual + intersection prefetch
- [ ] Core Web Vitals instrumentation (INP, LCP, CLS) reported to an analytics sink
- [ ] Route-level prefetch on hover/viewport with an idle-time budget
- [ ] Bundle budget gate in CI that fails the build on regression
- [ ] Image pipeline: AVIF/WebP `srcset`, priority hints, and CLS-safe aspect ratios
- [ ] Memory-leak hunt: detached-node and listener audit with a documented method

## Phase 12 — Resilience & Offline

- [ ] Error boundaries per route with retry, reset keys, and Sentry-style reporting
- [ ] Offline-first with a service worker: stale-while-revalidate + a background sync queue
- [ ] Request deduplication, cancellation via `AbortController`, and retry with jitter
- [ ] Optimistic cache updates in TanStack Query with rollback and invalidation rules
- [ ] Network-status-aware UI with a queued-mutation replay on reconnect

## Phase 13 — Accessibility & i18n

- [ ] WCAG 2.2 AA audit with axe in CI, zero-violation gate
- [ ] Focus management: focus traps, skip links, and route-change announcements
- [ ] Full keyboard interaction patterns for Modal, Menu, Combobox, and Tabs
- [ ] Screen-reader live regions for async status and toasts
- [ ] i18n with `react-intl`: plurals, dates, number formats, and an RTL layout pass

## Phase 14 — Security & TDD

- [ ] XSS-safe rendering: sanitisation policy and a `dangerouslySetInnerHTML` lint ban
- [ ] CSP with nonces wired through the Vite build
- [ ] Token storage hardening: in-memory access token + httpOnly refresh cookie, no `localStorage`
- [ ] Dependency supply-chain gate: `npm audit` + provenance check in CI
- [ ] TDD kata: one component built red→green→refactor, one commit per step
- [ ] Mutation testing with Stryker + a CI threshold
