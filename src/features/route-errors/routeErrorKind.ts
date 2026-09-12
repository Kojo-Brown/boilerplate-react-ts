/**
 * Whether a route error is worth retrying in place, and what to offer if not.
 *
 * This exists because "Try again" is a promise, and for the single most common
 * route error in a deployed SPA it is a lie. When a user has an old
 * `index.html` open and a new build has replaced the hashed chunks on the CDN,
 * the next route they visit fails its dynamic `import()` with a 404. That
 * error reaches the route's boundary like any other, and resetting the
 * boundary does nothing at all: `React.lazy` memoises the promise it created,
 * so a reset re-reads the *same rejected promise* and rethrows the identical
 * error in the same frame. The button re-renders the fallback it is attached
 * to, forever. (`SectionBoundary` documents the same shape for
 * `promiseCache.ts`; there the cure is invalidating the cache, and here there
 * is no cache to invalidate — `React.lazy` exposes none.)
 *
 * What does work is a document reload, because the fix is not the chunk, it is
 * the `index.html` that names it. So the classification is not cosmetic: it
 * decides between an action that can work and one that provably cannot.
 *
 * Detection is by message, which is unpleasant and is what every SDK does,
 * because no engine gives this rejection a distinguishable `name` or `code` —
 * it is a plain `TypeError` whose only distinguishing feature is prose that
 * differs per engine. All three engines' spellings are matched, and the
 * webpack-era `ChunkLoadError` name is matched too, since a project that
 * migrates to Vite keeps the error handling it already had.
 */

const CHUNK_LOAD_MESSAGE_PATTERNS: readonly RegExp[] = [
  // Chromium: `Failed to fetch dynamically imported module: <url>`
  /failed to fetch dynamically imported module/i,
  // Firefox, and Chromium for a module that 200s but fails to parse.
  /error loading dynamically imported module/i,
  // WebKit: `Importing a module script failed.`
  /importing a module script failed/i,
  // Vite's own preload helper, when the stylesheet beside the chunk is gone.
  /unable to preload css/i,
  // Chromium, when the server answers the chunk request with an HTML error
  // page: the MIME type check fails before anything is evaluated.
  /expected a javascript(?:-or-wasm)? module script/i,
];

export type RouteErrorKind =
  /** A dynamic import failed. Only a document reload can fix it. */
  | "chunk-load"
  /** Anything thrown by the route's own render. Resetting may well fix it. */
  | "render";

export function isChunkLoadError(thrown: unknown): boolean {
  if (typeof thrown !== "object" || thrown === null) return false;

  const name = "name" in thrown && typeof thrown.name === "string" ? thrown.name : "";
  // webpack's convention, kept because migrated projects still throw it.
  if (name === "ChunkLoadError") return true;

  const message = "message" in thrown && typeof thrown.message === "string" ? thrown.message : "";
  return CHUNK_LOAD_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

export function classifyRouteError(thrown: unknown): RouteErrorKind {
  return isChunkLoadError(thrown) ? "chunk-load" : "render";
}

/** Key under which a reload attempt is recorded, so one is never repeated. */
export const RELOAD_GUARD_KEY = "app:route-error:reloaded-at";

/**
 * How long a recorded reload suppresses another one.
 *
 * A reload for a stale chunk is a bet that the server will serve a newer
 * `index.html`. When the bet loses — a CDN still caching the old document, a
 * service worker answering from its own cache — the fresh document fails the
 * same import and, unguarded, reloads again: a tab that navigates in a loop
 * and never shows the user the error explaining why. The guard is a timestamp
 * rather than a flag so that a genuinely new failure, later in a long session,
 * is still allowed its one reload.
 */
export const RELOAD_GUARD_WINDOW_MS = 30_000;

export interface ReloadGuardOptions {
  /** Injected so tests do not touch real session storage or reload jsdom. */
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  windowMs?: number;
}

/**
 * Whether a reload may be attempted now, recording it when it may.
 *
 * `sessionStorage` rather than `localStorage`: the guard is about this tab's
 * current attempt to reach a working build, and it must not outlive the tab
 * and suppress a legitimate reload days later. Every access is guarded —
 * storage throws outright in a Safari private window, and an error path that
 * throws is worse than one that reloads twice.
 */
export function tryClaimReload(options: ReloadGuardOptions = {}): boolean {
  const {
    storage = typeof sessionStorage !== "undefined" ? sessionStorage : undefined,
    now = Date.now,
    windowMs = RELOAD_GUARD_WINDOW_MS,
  } = options;

  if (storage === undefined) return true;

  try {
    const raw = storage.getItem(RELOAD_GUARD_KEY);
    const previous = raw === null ? null : Number.parseInt(raw, 10);
    if (previous !== null && Number.isFinite(previous) && now() - previous < windowMs) {
      return false;
    }
    storage.setItem(RELOAD_GUARD_KEY, String(now()));
    return true;
  } catch {
    // No storage available. Allowing the reload is the better failure: the
    // loop it guards against needs a broken deployment as well as a missing
    // guard, and refusing every reload breaks the recovery outright.
    return true;
  }
}
