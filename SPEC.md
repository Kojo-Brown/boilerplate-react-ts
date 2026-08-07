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
- [ ] `use()` API for unwrapping promises and context inside Suspense boundaries
- [ ] Actions API: `useActionState` + `useFormStatus` replacing manual form submit state
- [ ] React Compiler enabled incrementally with an ESLint rule and a memo-removal audit
- [ ] Suspense-driven data fetching with streaming boundaries and nested fallbacks
- [ ] `startTransition` for route changes to keep the old UI interactive during navigation

## Phase 10 — Advanced Patterns & Architecture

- [ ] Compound components with context: `<Tabs><Tabs.List><Tabs.Panel>` and a typed slot API
- [ ] Headless component pattern: behaviour hooks split from presentation
- [ ] Polymorphic `as` prop with full generic type inference
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
