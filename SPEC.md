# Spec: boilerplate-react-ts

> Spec-driven. Each item is implemented in one 6-hour push. Do not skip items. Mark `[x]` after pushing.

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
- [ ] React Router 7 with typed routes, lazy loading, and ScrollRestoration
- [ ] Root layout with Navbar, Sidebar, and `<Outlet>`
- [ ] Protected route wrapper (auth guard) + redirect logic
- [ ] 404 / error boundary pages with retry

## Phase 4 — Auth
- [ ] JWT auth flow: login, logout, token refresh, silent refresh
- [ ] OAuth 2.0 PKCE flow (Google provider example)
- [ ] Auth context + `useAuth` hook with role-based access
- [ ] Persistent session via `localStorage` with expiry check

## Phase 5 — UI System
- [ ] Design token CSS variables (colors, spacing, radius, shadows)
- [ ] Component library: Button, Input, Modal, Toast, Spinner, Badge
- [ ] Dark mode toggle with `prefers-color-scheme` default
- [ ] Responsive layout primitives: Container, Grid, Stack, Divider

## Phase 6 — Performance
- [ ] Code splitting per route + `React.lazy` + `<Suspense>` skeletons
- [ ] Image optimization wrapper with lazy loading + blur placeholder
- [ ] Memoization patterns: `useMemo`, `useCallback`, `memo` examples
- [ ] Virtual list example with TanStack Virtual

## Phase 7 — Testing
- [ ] Vitest + Testing Library setup with `setup.ts` and MSW mocks
- [ ] Playwright E2E: login flow, protected route, API mock
- [ ] Component snapshot tests for UI system
- [ ] Coverage thresholds in `vitest.config.ts`

## Phase 8 — DevOps
- [ ] GitHub Actions: lint → test → build → preview deploy
- [ ] Dockerfile (multi-stage, nginx, non-root user)
- [ ] `.env.example` with all required vars documented
- [ ] Bundle analysis script (`rollup-plugin-visualizer`)
