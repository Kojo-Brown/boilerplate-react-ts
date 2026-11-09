# Mutation testing: does the suite actually assert?

Coverage tells you a line ran. It cannot tell you the line mattered. A test that
imports a module, calls every function and asserts `expect(result).toBeDefined()`
reports 100% coverage and would not notice the module being rewritten.

Mutation testing asks the other question. Stryker changes the source one edit at
a time — `<=` becomes `<`, a condition becomes `false`, a string becomes `""` —
and re-runs the tests that cover the changed line. A mutant the suite still
passes is a line whose behaviour no assertion pins down.

```
pnpm test:mutation
  │
  ├─ stryker.config.mjs              ← scope, threshold, the runner wiring
  │
  ├─ copies the project to .stryker-tmp/sandbox-*/
  │    └─ runs vitest.config.ts once  ← records which tests touch which line
  │
  ├─ for each mutant: re-runs only the tests covering it
  │    killed   → some test failed. Good.
  │    survived → every covering test still passed. A gap, or an equivalent mutant.
  │    no cov   → no test reaches the line at all.
  │
  └─ exit 1 below thresholds.break, + reports/mutation/index.html
```

This is the second half of a pair. The coverage thresholds in
[`vitest.config.ts`](../vitest.config.ts) say how much of the code the tests
_reach_; this says how much of it they _hold still_. Either one alone is
reassuring and wrong.

| File                                                                   | What it owns                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| [`stryker.config.mjs`](../stryker.config.mjs)                          | The scope, the threshold, the runner wiring    |
| [`tooling/mutation.audit.test.ts`](../tooling/mutation.audit.test.ts)  | That this document and that config still agree |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) (`mutation`) | The gate                                       |

## Running it

```
pnpm test:mutation
```

About four and a half minutes for 363 mutants. The HTML report at
`reports/mutation/index.html` is the one worth reading: it shows each mutant in
its own source line, which the terminal output cannot. CI uploads it as an
artifact on every run.

To work on one file, narrow the scope from the command line rather than editing
the config:

```
pnpm test:mutation --mutate src/shared/lib/paginationRange.ts
```

Both `.stryker-tmp/` and `reports/` are gitignored, and `.stryker-tmp/` is also
excluded from Vitest, ESLint and Prettier. The sandbox is a complete second copy
of the project with mutant switches spliced into every source file; left in
Vitest's scope, the first `pnpm test` after a mutation run collects both copies
of every suite.

## What is in scope, and why not everything

Eight modules, listed in `stryker.config.mjs`:

| Module                               | Score     |
| ------------------------------------ | --------- |
| `src/shared/lib/optimisticList.ts`   | 100.00    |
| `src/shared/lib/paginationRange.ts`  | 100.00    |
| `src/shared/lib/retrySchedule.ts`    | 100.00    |
| `src/shared/observability/redact.ts` | 100.00    |
| `src/shared/offline/routing.ts`      | 100.00    |
| `src/shared/lib/sanitizeHtml.ts`     | 98.18     |
| `src/shared/lib/filterableItems.ts`  | 91.43     |
| `src/shared/i18n/negotiateLocale.ts` | 88.57     |
| **total**                            | **97.80** |

Not `src/shared/**`. That is about 12,000 lines, and most of it is React. A
component's mutants are overwhelmingly about which class name or ARIA attribute
came out — which the accessibility gate and the component tests already hold —
and each one costs a jsdom mount to evaluate. These eight are where the mutants
Stryker generates land on real failures: a boundary off by one, a security
carve-out that stops carving, a comparator that disagrees with itself, a
redaction that stops redacting.

Adding a module is welcome. Removing one to recover a threshold is the thing
this document asks you not to do.

## What the first run found

The gate measured **89.26** on the suite as it stood, with 38 survivors. Six of
them were weak assertions worth fixing, and the fixes are the more interesting
half of the change that introduced this file:

- **`redact.ts` 75.71 → 100.00.** The worst of them, and the one that mattered
  most: this module exists to keep OAuth codes and access tokens out of the
  error backend. Its unparseable-URL branch was asserted with
  `expect(redacted).not.toContain("secret")`, which is true of returning the
  empty string, of cutting at offset 0, and of almost every other way of
  getting that branch wrong. Sixteen mutants survived behind it. The assertions
  now pin where the cut lands. Two further gaps were real: nothing asserted
  that `REDACTED` is `"[redacted]"` (every test compared against the constant
  on both sides, so `""` passed), and nothing asserted that the placeholder
  origin used to parse relative URLs is stripped back off — a reporter leaking
  `http://redact.invalid` into every breadcrumb would have passed.

- **`negotiateLocale.ts` 74.29 → 88.57.** Rule 1 (exact tag) and rule 2 (same
  language, any region) are separate rules, and against the two locales this
  application ships they are indistinguishable — `en-GB` and `ar-EG` are the
  only region of their language, so rule 2 reproduces rule 1's answer for every
  input the suite had. Deleting the exact match entirely left all eleven tests
  passing. The tests now state a world with two regions of one language, which
  is the only arrangement in which the priority is observable. A missing
  `trim()` was the other survivor.

- **`paginationRange.ts` 97.96 → 100.00.** The suite jumped from five pages to
  a hundred, so `pageCount <= MAX_ITEMS` — the switch between listing every
  page and windowing them — was never exercised at the count where it happens.
  Narrowing it to `<` is invisible at 5 and at 100 and wrong at exactly 7,
  where it spends a slot on a gap standing for nothing.

- **`routing.ts` 96.15 → 100.00.** `mode === "navigate" || destination ===
"document"` is a deliberate fallback for browsers that disagree. There was a
  test for `destination` alone, and the test for `mode` set both fields — so
  the `destination` clause carried it and the `mode` clause could be deleted
  without failing anything. Current engines are the case that reaches the
  `mode` clause; without it a navigation falls through to the runtime cache and
  the application stops opening offline.

- **`sanitizeHtml.ts` 96.36 → 98.18.** `ALLOW_SELF_CLOSE_IN_ATTR: false` is the
  jQuery 3.0 mXSS carve-out, and it reads like a redundant restatement of a
  DOMPurify default — the comment beside it says exactly that. Flipping it to
  `true` left every test passing. What it actually does is drop the whole
  attribute when its value carries self-closing syntax; the payload inside such
  a value is never executable as it stands, so the suite's coarse
  "no `on*=` attribute survives" net did not catch it either.

- **`optimisticList.ts` 95.56 → 100.00.** `withoutPending` was asserted with
  `expect(row).not.toHaveProperty("pending")`, which is also true of the empty
  object — so rebuilding the row from nothing instead of copying it passed. The
  other survivor was the early return for a row that has no marker to strip:
  removing it returns an equal-content _copy_, which `toEqual` cannot see, and
  which makes every row on the list a new object on every React replay.

## The eight survivors that remain

All eight are **equivalent mutants**: each describes a program
indistinguishable from the original, so no test can kill them. They are listed
here so that the first question about a red run is which column moved. A drop in
`# killed` is a weakened test. A jump in `# survived` on a file nobody touched
is usually a new equivalent mutant, and belongs on this list rather than under a
lowered threshold.

### `negotiateLocale.ts` — four, all on two redundant guards

```ts
if (wanted === "") continue;     // ← :54, two mutants
…
if (language === "") continue;   // ← :60, two mutants
```

Both guards are short-circuits over paths that already decline. An empty
`wanted` matches no supported tag, so `exact` is `undefined`; `languageSubtag("")`
returns `""`, so the `:60` guard sends it to the next candidate anyway. Likewise
an empty `language` matches no supported tag's language subtag. Removing either
guard — or comparing against `"Stryker was here!"` — changes no answer for any
input, because no `LocaleTag` is the empty string. They are kept because reading
the loop without them requires knowing that, which is the opposite of what a
guard is for.

### `filterableItems.ts` — three

```ts
state = (state + 0x6d2b79f5) >>> 0; // ← :64
t ^= t + Math.imul(t ^ (t >>> 7), t | 61); // ← :67
```

Two arithmetic operators inside mulberry32. Flipping either produces a
_different_ stream that is still deterministic, still in `[0, 1)` and still
well-distributed, so every contract this generator has — same seed, same rows;
scores spread across the range; the whole word vocabulary drawn on — holds for
the mutant too. Pinning the stream itself would mean asserting golden values for
a demo dataset, which fixes an implementation detail no caller depends on and
breaks on any change to the generator that is not a bug.

```ts
if (!needle) return true; // ← :106
```

A fast path, not a decision. With it removed, the empty query falls through to
`item.name.toLowerCase().includes("")`, and `String.prototype.includes("")` is
`true` for every string — including the empty one. There is no input that tells
the two apart.

### `sanitizeHtml.ts` — one

```ts
if (instance !== null) return instance; // ← :197
```

The memo on the lazy DOMPurify singleton. Removing it rebuilds the purifier on
every `sanitizeHtml` call, which is slower and sanitises identically: the
factory is pure with respect to `window`, and this module registers no hooks on
the instance. `instance` is module-private, so the identity that would
distinguish them is not observable from a test. The memo stays for the reason
the comment above it gives — it keeps the factory out of module scope so the
module stays importable from a `@vitest-environment node` test.

## Changing the threshold

`thresholds.break` is 96, against a measured 97.80 — about seven mutants of
room. That gap is not slack to spend. It is there because which equivalent
mutants Stryker generates shifts with refactors that change no behaviour at all,
and a gate that goes red on a rename is a gate that gets switched off.

Raise it when the real score rises. Do not lower it, and do not drop a module
from `mutate`, to turn a red build green: both make the gate measure less while
reporting the same kind of number, which is the failure mode this gate exists to
catch in the first place. If a survivor is genuinely equivalent, add it to the
list above with the argument for why — that is a reviewable claim, where a
threshold of 90 is not.
