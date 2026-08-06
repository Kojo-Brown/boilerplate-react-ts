# boilerplate-react-ts

> React 19 · TypeScript 6 · Vite 7 · TailwindCSS 4 · Redux Toolkit 2 · TanStack Query 5

Production-grade SPA starter. Clone, configure `.env`, and ship.

## Stack

| Layer        | Tech                                  | Version       |
| ------------ | ------------------------------------- | ------------- |
| UI           | React + TypeScript                    | 19.2 / 6.0    |
| Build        | Vite                                  | 7             |
| Styles       | TailwindCSS                           | 4.3           |
| Global state | Redux Toolkit                         | 2.12          |
| Server state | TanStack Query                        | 5.101         |
| Routing      | React Router                          | 7             |
| Forms        | React Hook Form + Zod                 | 8 / 4         |
| Testing      | Vitest + Testing Library + Playwright | 3 / 16 / 1.52 |
| Mocking      | MSW                                   | 2             |
| Linting      | ESLint 9 + Prettier 3                 |               |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/Kojo-Brown/boilerplate-react-ts.git
cd boilerplate-react-ts
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Develop
pnpm dev        # http://localhost:3000

# 4. Test
pnpm test
pnpm test:e2e

# 5. Build
pnpm build
```

## Project Structure

```
src/
├── api/          # API client + TanStack Query queryClient
├── components/
│   └── ui/       # Design system primitives (Button, Input, Modal…)
├── hooks/        # Custom hooks
├── lib/          # Utilities (cn, etc.)
├── pages/        # Route-level components
├── store/        # Redux slices + typed hooks
├── styles/       # Global CSS + design tokens
├── test/         # MSW handlers, setup, test utilities
├── types/        # Shared TypeScript types
└── env.ts        # Typed + validated env vars (Zod)
```

## Design Tokens

All design tokens are CSS custom properties on `:root`. Override in `.dark` for dark mode:

```css
--color-primary   /* brand colour */
--color-bg        /* page background */
--color-fg        /* default text */
--color-muted     /* subtle backgrounds */
--color-border    /* borders and dividers */
--color-danger    /* error/destructive */
--color-success   /* success states */
--radius-sm/md/lg /* border radius scale */
```

## React 19 Concurrency

`<ConcurrentFilterList>` (`src/components/performance/`) filters a large list
without letting the render block typing:

- **`useDeferredValue`** splits the query into an urgent copy (what the input
  shows) and a lagging copy (what the list renders from). While the two
  disagree the list is marked stale — dimmed, `aria-busy`, `data-stale="true"`.
- **`useTransition`** marks the category change as interruptible, so the
  previous results stay on screen and interactive instead of flashing a
  spinner.
- **`memo` on the row subtree** is what makes deferring pay off. Without it the
  urgent keystroke render still rebuilds and reconciles every child, so the
  keypress keeps paying for the whole list. Because the filtered array is
  referentially stable until the deferred query catches up, React skips the
  subtree entirely while you are still typing.

Deferring schedules the work differently; it does not make it smaller. For a
list this size in a real screen, combine it with `<VirtualList>`.

### Jank benchmark

`/labs/concurrency` is a harness for the pattern — dataset size and scheduling
mode come from the URL (`?mode=blocking&n=15000`), and the page records real
frame timings with `src/lib/jankMeter.ts`. `e2e/concurrency-benchmark.spec.ts`
drives both arms and fails if the gap disappears:

```bash
pnpm test:e2e concurrency-benchmark --project=chromium
```

15,000 rows, typing `deferred` at 60ms/keystroke, Chromium, dev server
(StrictMode double-renders, so both arms are inflated — the comparison is what
matters, not the absolute numbers):

| Metric                      | Blocking (before) | Concurrent (after) |
| --------------------------- | ----------------- | ------------------ |
| Worst keypress → paint      | 824 ms            | 256 ms             |
| Time spent blocked on input | 3424 ms           | 1360 ms            |
| Longest frame               | 800 ms            | 317 ms             |

Absolute numbers move with the machine; across runs the ratio held at roughly
3× on worst keypress-to-paint. The spec asserts a 2× floor, so it fails on a
regression without failing on noise.

Frame numbers improve less than input numbers, and that is the honest result:
rendering becomes interruptible, but the commit that finally inserts the rows
does not. What concurrency buys is that the keystroke no longer waits for it.

## Spec Progress

See [SPEC.md](./SPEC.md) for the full feature roadmap and implementation status.

## Docker

```bash
docker build -t my-app .
docker run -p 80:80 my-app
```
