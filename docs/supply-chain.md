# Dependency supply chain

`pnpm supply-chain` is the gate. It runs as its own CI job on every pull
request and asks three questions about the dependency tree:

1. **Is what we install what the publisher signed?** Every package in
   `pnpm-lock.yaml` must resolve from the registry, and the integrity hash this
   repository has committed must match a valid npm publisher signature for that
   exact name and version.
2. **Does anything have a known vulnerability?** `pnpm audit`, read through the
   severity floor and suppressions in `supply-chain-policy.json`.
3. **Has anything stopped attesting its build?** A package that published SLSA
   provenance and no longer does is reported.

```
pnpm supply-chain                  # the gate
pnpm supply-chain:update           # re-record the provenance baseline
pnpm supply-chain --skip-audit     # signatures and provenance only
```

The implementation is in `tooling/supplyChain/`. It needs the network, and that
is deliberate: signatures and advisories are statements the registry makes
_now_, so a version of this check that could run from a cache would be
answering last week's question. What it must never do is treat an unreachable
registry as a pass — every failure to read is an error, and the gate exits 2.

## Why this is not `npm audit`

The spec item asks for `npm audit`, and `npm audit` cannot run here. It walks an
npm install tree; pnpm's `node_modules` is a symlink farm around a
content-addressed store with no `package-lock.json` in it. `pnpm audit` queries
the same registry endpoint for the same advisory data, so that is what the gate
shells out to.

`npm audit signatures` is in the same position, and the answer is different:
rather than drop the check, `tooling/supplyChain/signature.ts` reimplements it
over `pnpm-lock.yaml`. That turns out to be a **stronger** check than npm's own,
for a reason worth stating plainly. npm verifies a signature over an integrity
it has just re-read from the registry, which proves only that the registry
agrees with itself. The integrity verified here is the one committed to this
repository, so a valid signature means: _the tarball this lockfile pins is the
tarball the publisher signed_. Tamper with a hash in `pnpm-lock.yaml` and the
gate fails.

What the signature does **not** prove is that the published tarball is
trustworthy — a compromised maintainer account signs a malicious release
perfectly well. That is what provenance is for.

## The severity floor is `moderate`

`audit.failOn` in `supply-chain-policy.json`.

`high` is the common choice and it is too loose: it lets a moderate
path-traversal in the test runner sit unreported indefinitely. `low` is too
tight for a tree that is 90% build tooling — a steady drip of low-severity
denial-of-service advisories in transitive dev dependencies would make the gate
something people route around, and a gate people route around is worse than a
looser one they trust. Advisories below the floor are still _reported_, just not
fatal.

A known limitation, and a deliberate non-goal of the change that added this:
the floor does not distinguish production from development dependencies. The
right policy is almost certainly stricter for what ships to users than for what
builds it, and `pnpm audit`'s own `dev` flag cannot be used to implement it —
it reports `dev: false` for `typescript-eslint` and counts
`devDependencies: 0`. Getting it right means attributing every transitive
package to prod or dev by walking the lockfile's `snapshots:` graph, which is
its own piece of work.

## Suppressions expire

```json
{
  "advisory": "GHSA-xxxx-xxxx-xxxx",
  "reason": "dev-only; no reachable path from application code, fix tracked upstream",
  "expires": "2026-12-31"
}
```

Keyed on the **GHSA id**, not the numeric one: pnpm gives the same advisory two
different numeric ids within a single report, so an allowlist keyed on the
number would silently stop matching — and a suppression that stops matching
fails open, turning into `allow-unused` while the advisory it covered
reappears.

Three rules keep the list from rotting:

- A `reason` under 20 characters is refused. The number is arbitrary; the point
  is that a field which accepts `"wontfix"` will receive `"wontfix"`, and a
  suppression nobody had to justify is one nobody revisits. The reviewer of the
  diff that adds the entry is the only real control, and this gives them
  something to review.
- An **expired** entry stops suppressing. The gate then reports two findings:
  the dead suppression, and the advisory it is no longer covering. Reporting
  only the first would leave the reader thinking the vulnerability had gone.
- An entry matching **no** advisory fails. The dependency was fixed or removed,
  so the entry should go too.

`pnpm supply-chain:update` drops expired entries rather than renewing them.
Renewing one is a decision with a reason attached, and that is a human's to
write.

## Provenance is a ratchet, not a requirement

`provenance.attested` lists the packages observed to publish
[SLSA provenance](https://slsa.dev/provenance/v1). It is a recording, not a
policy: **207 of 482** packages in this tree publish provenance, so requiring it
outright would mean deleting most of the dependency list.

What _is_ enforceable, and worth more than a number nobody can act on, is that
coverage does not go backwards. The gate fails when:

- a recorded package **stops** publishing provenance (`provenance-lost`) — a
  release pipeline that stopped attesting is either compromised or has changed
  hands, and both deserve a human reading the diff;
- a package publishes provenance and is **not** recorded
  (`provenance-unrecorded`) — an unrecorded guarantee is one that cannot be
  held, so run `pnpm supply-chain:update`;
- a recorded package is **no longer installed** (`provenance-stale`) — the
  baseline would otherwise claim coverage it does not have.

A package that never had provenance is simply not covered, and the gate says
nothing about it.

The baseline is keyed by package **name**, not `name@version`. A version bump
that drops provenance is exactly the regression worth catching, and keying on
the version would make every routine bump look like a new package instead.

## npm's retired signing key

159 of the 482 packages here verify against a key npm retired on **2025-01-29**,
and the gate accepts them. This is the one judgement call in
`tooling/supplyChain/signature.ts` and it goes the other way from the obvious
reading, so:

npm rotated its signing key and still serves the old one from
`/-/npm/v1/keys`. It does that deliberately. Versions published before the
rotation are signed under the old key and are never re-signed — npm does not
retroactively re-sign history. Rejecting a retired key would therefore fail a
third of any real dependency tree, permanently, and the only available fix
would be to turn the check off.

It would also buy nothing. The guarantee is cryptographic: a forged tarball
cannot produce a signature that verifies under the retired key either, because
that key's private half is no more available to an attacker than the current
one's. Expiry means "stop signing new things with this" — a statement about
npm's publishing pipeline, not about whether a signature made under it is
sound. The case that _would_ mean "no longer trust these" is the registry
**deleting** the key, and that is already covered: the key would then be
`unknown-key`, which fails.

So expiry is recorded and reported rather than enforced. The count appears in
the job summary, because a number that quietly grows to 482 would mean npm had
stopped signing anything new.

## Off-registry dependencies fail

A `git:`, `file:` or bare-`tarball:` resolution is reported as `off-registry`
and fails the gate. This is not a gap in the gate's coverage — it _is_ the
finding. Nothing signs a git revision and nothing pins a branch, so such a
dependency carries none of the guarantees the other 480 do. There is no
suppression mechanism for it: vendoring a fork is a decision that should be
visible in the diff that makes it.

## Security floors in `package.json`

Two kinds of entry exist because the tree needed two kinds of fix:

- **Direct dependencies with advisories** get their declared range raised
  (`react-router: ^7.18.2`). Explicit, and it keeps peer ranges consistent.
- **Transitive-only packages** get a `pnpm.overrides` entry per major line
  (`"brace-expansion@1": "^1.1.21"`).

Override values are **bounded ranges**, and this matters more than it looks.
`pnpm audit --fix` writes unbounded ones — `"vitest@4": ">=4.1.11"` — and an
unbounded value resolves to the registry's latest, so that entry installs
`vitest@5.0.4`: a major upgrade arriving disguised as a security patch, past
the declared `^4.1.10`. Always write a caret.

An override is a floor, not a pin. Remove one once the declared range's own
floor has risen past it; nothing breaks if you forget, but it is dead weight
that reads as coverage.

## Adding a dependency

```
pnpm add <pkg>
pnpm supply-chain          # fails: provenance-unrecorded, if it attests
pnpm supply-chain:update   # record it
```

Review the `supply-chain-policy.json` diff before committing it. An addition is
routine; a _removal_ from `attested` means something that used to prove how it
was built has stopped, and the update command prints those by name for that
reason.
