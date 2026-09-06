/**
 * Turning Vite's build manifest into the two numbers that matter.
 *
 * A bundle budget is only as honest as its idea of "the bundle". Three ideas
 * are wrong in ways that look right:
 *
 * 1. **Everything in `dist/`.** `build.sourcemap` is on, so `dist/` is ~4MB of
 *    `.map` files that no browser downloads. A budget over that number is
 *    measuring the debug artefacts.
 * 2. **Every `.js` in `dist/assets/`.** Twenty of the twenty-six chunks here
 *    are `React.lazy` routes. Adding a route would fail a budget that nothing
 *    about first load has changed, so the budget gets raised, and the one
 *    thing it existed to protect stops being protected.
 * 3. **The entry chunk alone.** `manualChunks` splits `react-router`,
 *    `@reduxjs/toolkit` and `@tanstack/react-query` out of the entry, and the
 *    browser fetches all of them before the first route renders — Vite emits a
 *    `<link rel="modulepreload">` for each. Moving 40kB from the entry into a
 *    new manual chunk changes nothing a user experiences and would show up as
 *    a 40kB win.
 *
 * The set the browser actually blocks on is the entry chunk plus the transitive
 * closure of its **static** imports, and that is a graph walk, not a glob. The
 * manifest is the only place that graph exists after the build: `imports` is
 * static, `dynamicImports` is not, and the distinction is erased in `dist/`.
 */

/** One chunk or asset as Vite's `.vite/manifest.json` describes it. */
export interface ManifestEntry {
  file: string;
  name?: string | undefined;
  src?: string | undefined;
  isEntry?: boolean | undefined;
  isDynamicEntry?: boolean | undefined;
  imports?: readonly string[] | undefined;
  dynamicImports?: readonly string[] | undefined;
  css?: readonly string[] | undefined;
  assets?: readonly string[] | undefined;
}

export type Manifest = Readonly<Record<string, ManifestEntry>>;

/** A chunk the browser downloads before the first route can render. */
export interface InitialChunk {
  /** Manifest key, e.g. `index.html` or `_router-ChavgIu3.js`. */
  key: string;
  /** Budget id, e.g. `chunk.router`. Stable across content-hash changes. */
  name: string;
  /** Path relative to the build output root. */
  file: string;
}

/** A lazily-loaded route and everything a cold cache pays to reach it. */
export interface LazyRoute {
  key: string;
  name: string;
  /**
   * The route's own chunk plus every shared chunk it statically imports that
   * is *not* already in the initial graph.
   *
   * This is the number a user pays on navigation, and it is not the size of
   * the route chunk. `/login` is a 13.2kB chunk that also pulls `FormField`,
   * `Input` and `oauth`; reporting 13.2kB understates it by a fifth. Shared
   * chunks are counted once per route that needs them, on purpose — two routes
   * sharing a 5kB helper each pay 5kB on a cold cache, and a budget on "the
   * most expensive route" is a claim about one navigation, not about the sum
   * of bytes on disk.
   */
  files: readonly string[];
}

export interface BundleGraph {
  /** JS chunks in the initial graph, entry first. */
  initialChunks: readonly InitialChunk[];
  /** Stylesheets pulled in by those chunks. */
  initialCss: readonly string[];
  /** Every `React.lazy`/`import()` entry point, with its cold-cache cost. */
  lazyRoutes: readonly LazyRoute[];
  /** Every file the manifest accounts for, for reconciling against `dist/`. */
  emittedFiles: ReadonlySet<string>;
}

/**
 * The budget id for a chunk.
 *
 * The manifest key is content-addressed (`_router-ChavgIu3.js`), so it changes
 * whenever the chunk's contents do — a budget keyed by it would need editing
 * on every commit that touched the router, which is a budget nobody reads.
 * Rollup's `name` is the stable half of that filename and is what the budget
 * file is keyed by.
 *
 * The HTML entry is the exception: its manifest key is `index.html` while its
 * `name` is `index`, matching the chunk it actually describes.
 */
export function chunkName(key: string, entry: ManifestEntry): string {
  if (entry.name !== undefined && entry.name !== "") return entry.name;
  // Rollup omits `name` for some emitted chunks. Falling back to the key is
  // worse than a hash-stripping regex would be on a good day and better on a
  // bad one: it is wrong loudly (the budget id changes, the gate fails and
  // says so) rather than quietly mapping two chunks onto one id.
  return key;
}

/**
 * Static-import closure of `roots`, in visit order.
 *
 * `dynamicImports` is deliberately not followed: that edge is an `import()`,
 * which is a separate request the browser makes later or never.
 */
function staticClosure(manifest: Manifest, roots: readonly string[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const key = stack.pop();
    if (key === undefined || seen.has(key)) continue;
    const entry = manifest[key];
    // A manifest can name an import it has no entry for only if it is
    // truncated or hand-written; skipping is right for the fixtures and
    // harmless for a real build, where every key resolves.
    if (entry === undefined) continue;
    seen.add(key);
    order.push(key);
    for (const next of entry.imports ?? []) stack.push(next);
  }
  return order;
}

/** Files a chunk contributes: its own output plus its stylesheets and assets. */
function filesOf(entry: ManifestEntry): string[] {
  return [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])];
}

/**
 * Classify a manifest into initial cost, per-route cost, and everything the
 * manifest claims to have emitted.
 *
 * Entry order is preserved so the report reads the same way twice.
 */
export function buildGraph(manifest: Manifest): BundleGraph {
  const keys = Object.keys(manifest);
  const entryKeys = keys.filter((k) => manifest[k]?.isEntry === true);

  const initialKeys = staticClosure(manifest, entryKeys);

  const initialChunks: InitialChunk[] = [];
  const initialCss = new Set<string>();
  for (const key of initialKeys) {
    const entry = manifest[key];
    if (entry === undefined) continue;
    initialChunks.push({ key, name: chunkName(key, entry), file: entry.file });
    for (const css of entry.css ?? []) initialCss.add(css);
  }

  const initialFiles = new Set(
    initialChunks.flatMap((c) => filesOf(manifest[c.key] ?? { file: "" })),
  );

  const lazyRoutes: LazyRoute[] = [];
  for (const key of keys) {
    const entry = manifest[key];
    if (entry?.isDynamicEntry !== true) continue;
    // Every lazy chunk statically imports the entry chunk (Rollup hoists the
    // shared module graph into it), so the closure below always contains the
    // initial set. Subtracting it is what makes the number "what this
    // navigation costs" rather than "what the whole app costs".
    const files = staticClosure(manifest, [key])
      .flatMap((k) => filesOf(manifest[k] ?? { file: "" }))
      .filter((f) => f !== "" && !initialFiles.has(f));
    lazyRoutes.push({ key, name: chunkName(key, entry), files: [...new Set(files)] });
  }

  const emittedFiles = new Set<string>();
  for (const key of keys) {
    const entry = manifest[key];
    if (entry === undefined) continue;
    for (const file of filesOf(entry)) if (file !== "") emittedFiles.add(file);
  }

  return {
    initialChunks,
    initialCss: [...initialCss],
    lazyRoutes,
    emittedFiles,
  };
}
