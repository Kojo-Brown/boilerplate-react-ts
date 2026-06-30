# boilerplate-react-ts

> React 19 · TypeScript 6 · Vite 7 · TailwindCSS 4 · Redux Toolkit 2 · TanStack Query 5

Production-grade SPA starter. Clone, configure `.env`, and ship.

## Stack

| Layer | Tech | Version |
|-------|------|---------|
| UI | React + TypeScript | 19.2 / 6.0 |
| Build | Vite | 7 |
| Styles | TailwindCSS | 4.3 |
| Global state | Redux Toolkit | 2.12 |
| Server state | TanStack Query | 5.101 |
| Routing | React Router | 7 |
| Forms | React Hook Form + Zod | 8 / 4 |
| Testing | Vitest + Testing Library + Playwright | 3 / 16 / 1.52 |
| Mocking | MSW | 2 |
| Linting | ESLint 9 + Prettier 3 | |

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

## Spec Progress

See [SPEC.md](./SPEC.md) for the full feature roadmap and implementation status.

## Docker

```bash
docker build -t my-app .
docker run -p 80:80 my-app
```
