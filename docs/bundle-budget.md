# The bundle budget gate

Bundle size regresses the way a room gets untidy: never in one visible act.
Nobody adds 200kB. Somebody adds a date library to a utility that a shared
component imports, and six weeks later the entry chunk is a third larger and
there is no commit to point at. The gate exists to put a number in front of the
person who added the import, in the pull request where they added it, while the
alternative is still cheap.

- `bundle-budget.json` — the ceilings, in compressed bytes
- `tooling/bundleBudget/` — the checker
- `pnpm bundle:budget` — run it against an existing `dist/`
- `pnpm bundle:budget:update` — rewrite the ceilings from the current build
- CI: a step of the **Build** job, before the artefact upload

## What gets measured, and why it is not "the size of dist/"

Three plausible definitions of "the bundle" are wrong here, each in a way that
looks fine on the day it is written:

**Everything in `dist/`.** `build.sourcemap` is on, so about 80% of `dist/` by
weight is `.map` files that no browser requests. A budget over that number is
mostly a budget on the debug artefacts, and it goes green the day someone turns
sourcemaps off.

**Every `.js` under `dist/assets/`.** Twenty of this app's thirty-six chunks are
`React.lazy` routes. Adding a route would fail a budget when nothing about
first load had changed, so the budget gets raised, and the thing it existed to
protect stops being protected — on a pull request that was innocent.

**The entry chunk.** `manualChunks` splits `react-router`, `@reduxjs/toolkit`
and `@tanstack/react-query` out of the entry, and the browser fetches all of
them before the first route renders: Vite writes a `<link rel="modulepreload">`
for each into `index.html`. Under an entry-chunk budget, moving 40kB into a new
manual chunk reads as a 40kB win and changes nothing a user experiences.

What the browser actually blocks on is the entry chunk plus the transitive
closure of its **static** imports. That is a graph walk, and the graph does not
survive into `dist/` — by then a static import and an `import()` are both just
files. Vite's build manifest is the only artefact that still knows the
difference, which is why `vite.config.ts` sets `build.manifest: true` and why
the checker refuses to run without it.

## The ids

| id             | what it is                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------- |
| `initial.js`   | Every JS chunk the browser fetches before the first route renders. **The headline number.** |
| `initial.css`  | Stylesheets reached from those chunks.                                                      |
| `chunk.<name>` | One ceiling per chunk in the initial graph, so a regression says _where_.                   |
| `lazy.largest` | The most expensive single route navigation, on a cold cache.                                |
| `unattributed` | Everything shipped that the manifest cannot see.                                            |

`initial.js` is deliberately redundant with the `chunk.*` entries that add up to
it. Keeping both is what closes the loophole in per-chunk budgets: a chunk over
its ceiling can be brought back under it by splitting it in two, which changes
the number of requests and nothing else. The sum does not move, so the sum is
what is budgeted; the parts are there to say where it moved.

### `lazy.largest` is not the size of the largest lazy chunk

A route costs its own chunk **plus every shared chunk it statically imports that
is not already in the initial graph**. `/login` is a 13.21kB chunk that also
pulls `FormField`, `Input` and `oauth`; the navigation costs 14.81kB, so calling
it 13.21kB is 12% light. Shared chunks are counted once per route that needs them,
on purpose — two routes sharing a 5kB helper each pay 5kB on a cold cache, and
this is a claim about one navigation, not about the sum of bytes on disk.

This also means the ranking here disagrees with the chunk list Vite prints at
the end of a build, and the disagreement is the point.

### `unattributed` exists because the manifest is incomplete

Vite builds workers in a **separate Rollup pass** whose output never reaches
`.vite/manifest.json`. `csvParser.worker-*.js` is 7.4kB of real payload that a
graph walk cannot see. Anything in `public/` is copied verbatim and is likewise
absent — including `mockServiceWorker.js`, which is 9.7kB of mocking
infrastructure this repository currently ships to production.

So the checker reconciles `dist/` against the manifest and budgets the
remainder, rather than trusting the manifest to be complete. Sourcemaps and
`.vite/` are the two exclusions, because no browser asks for either.

## Sizes are gzip, at a pinned level

Raw byte counts price 30kB of new component code the same as 30kB of inlined
base64, and are wrong about both: minified JS compresses at roughly 3:1 and
base64 at close to 1:1. Nobody serves either uncompressed.

The absolute number is still a proxy — a CDN picks its own level and may serve
brotli where this measures gzip. That is fine for a gate, whose question is "did
this pull request make it bigger", not "how many bytes will Cloudflare send".
What matters is that both sides of that comparison are measured identically,
which is why the level is pinned at `Z_BEST_COMPRESSION` rather than left at
zlib's default of 6, which has moved between zlib releases. Set
`"compression": "brotli"` in `bundle-budget.json` to switch, and re-run
`pnpm bundle:budget:update` — the two are not comparable.

## Ceilings, not a diff against `main`

"Fail on regression" invites a comparison against a stored baseline, and every
place a baseline can live is worse than the diff:

- **A CI artefact from `main`** expires, and is missing on the first build after
  a cache eviction. The gate then degrades to "pass" precisely when nobody is
  looking.
- **A committed baseline a bot updates on every merge** is a number nobody
  reviews. It records what happened; it does not ask anyone about it.
- **A ceiling in `bundle-budget.json`** is the only version where raising it is
  a line in a pull request that a human reads and approves.

The cost is real and worth naming: a regression that stays under the ceiling
passes. That is why `pnpm bundle:budget:update` writes ceilings with 5%
headroom rather than a comfortable round number, and why the report prints how
much headroom each id has left even when everything is green — a change that
takes `initial.js` from 140kB to 178kB against a 185kB ceiling passes the gate
and is still the most interesting thing in the build.

## Two failures that are not "too big"

These are what keep the ceilings meaningful a year from now.

**`missing-budget` — a chunk entered the initial graph with no ceiling.** Add a
`manualChunks` entry and 40kB moves into a chunk nothing is watching. Only
`initial.js` notices, and the obvious way to make it green is to raise
`initial.js` rather than to add the line that was missing.

**`stale-budget` — a ceiling outlived the chunk it was written for.** Harmless
on its own, which is exactly why it rots: a `chunk.vendor` left behind after
`vendor` was renamed reads as coverage that does not exist.

## When the gate fails

1. **Look at which id moved.** `initial.js` up while every `chunk.*` is flat
   means a new chunk joined the initial graph. One `chunk.*` up alone means
   something was added to that chunk — `pnpm analyze` opens a treemap of it.
2. **Ask whether it should be lazy.** The commonest real cause is a module that
   only one route needs being imported at the top of something everything
   needs. Moving the import inside the route moves the bytes into that route's
   chunk, where `lazy.largest` will price it honestly.
3. **If the growth is intended, raise the ceiling on purpose.** Run
   `pnpm bundle:budget:update`, commit the change to `bundle-budget.json` in the
   same pull request, and say in the description what the bytes bought. That
   diff is the entire point of the gate: it makes the trade-off visible to a
   reviewer instead of leaving it to be discovered later by a user on a phone.

Never edit `bundle-budget.json` to make an unexplained regression go away. A
ceiling raised without a reason is a gate that has been turned off slowly.

## Known gaps

- **The gate is per-build, not per-pull-request.** It cannot report "+4.2kB
  since `main`", only "4.2kB under the ceiling". Getting the delta needs a
  baseline, and the reasons not to keep one are above.
- **`vendor` contains only `react`.** `manualChunks` names
  `["react", "react-dom"]`, but `src/app/main.tsx` imports `react-dom/client`,
  which is a different module id and so is not matched — `react-dom` is in the
  entry chunk, and `chunk.vendor` is 1.4kB of `react` alone. The gate surfaced
  this rather than caused it, the ceilings record the layout as it is today, and
  fixing the split belongs to whoever changes the chunking on purpose.
- **`mockServiceWorker.js` ships.** 9.7kB of it, in `unattributed`, on every
  production deploy. It is inert unless something calls `worker.start()`, but it
  is downloaded by anyone who requests it.
- **CSS is one number.** Tailwind emits a single stylesheet, so there is nothing
  finer to budget until a route-level CSS split exists.
