# boilerplate-react-ts — Agent Instructions

## What this repo is

Production-grade React 19 + TypeScript 6 SPA boilerplate. Spec-driven: features are added one at a time per SPEC.md.

## Your job (scheduled agent, every 4h)

1. `git checkout main && git pull --ff-only origin main`
2. Read `SPEC.md`, take the **first** `- [ ]` item. Phase 0 items always win.
3. `git checkout -b <type>/<kebab-slug>` (`feat`/`fix`/`chore`/`ci`/`docs`)
4. Implement it completely — source, types, tests, docs.
5. Run every gate locally; **all must pass** before pushing:
   ```
   pnpm install
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   ```
6. Commit, `git push -u origin <branch>`, then `gh pr create`.
7. `gh pr checks --watch` → **merge only if every check is green**:
   `gh pr merge --squash --delete-branch`
8. Pull main, mark the item `- [x]` in `SPEC.md`, update `../PROGRESS.md`,
   push as a `chore:` commit.

If a check fails, fix forward on the same branch. Never merge red. Never weaken
a test or lower a coverage threshold to force green.

## Secrets

Never commit real credentials, tokens, keys, or `.env` files. Placeholders in
`.env.example` only. Test fixtures must look obviously fake. Scan
`git diff --cached` before every push.

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
