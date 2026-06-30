# boilerplate-react-ts — Agent Instructions

## What this repo is
Production-grade React 19 + TypeScript 6 SPA boilerplate. Spec-driven: features are added one at a time per SPEC.md.

## Your job (scheduled agent)
1. Read `SPEC.md` — find the first `- [ ]` item
2. Implement it completely and correctly using the versions below
3. Run `pnpm install` if you added deps, `pnpm typecheck && pnpm lint` before committing
4. `git add -A && git commit -m "feat: <feature name>" && git push origin main`
5. Mark the item `- [x]` in SPEC.md and push again: `git commit -m "chore: mark spec item done" && git push`
6. Update `/Users/nicholasbrown/Desktop/Boilerplates/PROGRESS.md`

## Versions (do not change)
- React 19.2.7 | TypeScript 6.0.3 | Vite 7 | TailwindCSS 4.3.2
- RTK 2.12.0 | TanStack Query 5.101.2 | React Router 7
- Vitest 3 | Playwright 1.52 | MSW 2

## Conventions
- All paths use `@/` alias (maps to `src/`)
- CSS custom properties via `var(--color-*)` tokens in `globals.css`
- Named exports only (no default exports except pages)
- `cn()` from `@/lib/cn` for conditional classes
- No `any`, no `@ts-ignore` — fix type errors properly
- Every new component gets a co-located `.test.tsx`
