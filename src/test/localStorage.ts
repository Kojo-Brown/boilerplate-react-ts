/**
 * A spec-compliant in-memory `Storage` implementation.
 *
 * Vitest's jsdom environment does not currently expose jsdom's real `Storage`
 * on the test global — `globalThis.localStorage` arrives as a bare object with
 * no `getItem`/`setItem`/`clear`. jsdom itself implements Storage correctly, so
 * this only papers over the environment bridge, and it is installed in
 * `setup.ts` only when the global is genuinely unusable.
 */
export class MemoryStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, value);
  }

  removeItem(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}

/** True when the global lacks a usable Storage implementation. */
function isUnusable(candidate: unknown): boolean {
  return typeof (candidate as Storage | undefined)?.clear !== "function";
}

/** Installs {@link MemoryStorage} for `localStorage`/`sessionStorage` if needed. */
export function installStorageFallback(): void {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    if (!isUnusable(globalThis[name])) continue;
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, name, {
      value: storage,
      configurable: true,
      writable: true,
    });
    if (typeof window !== "undefined") {
      Object.defineProperty(window, name, {
        value: storage,
        configurable: true,
        writable: true,
      });
    }
  }
}

/**
 * The key MSW uses for its own cookie jar, which is not application state.
 *
 * `setupServer` honours `Set-Cookie` by keeping a jar, and under jsdom it
 * persists that jar to `localStorage`. So from the moment the auth handlers
 * started issuing a real refresh cookie, every suite that touches them has an
 * extra `localStorage` key — written by the test harness, containing the
 * harness's copy of the cookie.
 *
 * This matters for what a unit test can honestly claim. `localStorage.length
 * === 0` stops meaning "the application persisted nothing" and starts meaning
 * "the application persisted nothing *and* no handler set a cookie", which is
 * the opposite of what these tests want to exercise. Worse, the jar's value
 * contains the refresh token, so a jsdom test that grepped storage for the
 * token would fail on MSW's bookkeeping while the application was behaving
 * perfectly.
 *
 * The split that follows: a unit test asserts the *application* writes nothing,
 * using {@link appStorageKeys} to exclude this one key. That an `HttpOnly`
 * cookie is genuinely unreachable from JavaScript is a browser guarantee, not a
 * jsdom one, and is asserted in `e2e/token-storage.spec.ts` against a real
 * cookie jar instead.
 */
export const MSW_COOKIE_STORE_KEY = "__msw-cookie-store__";

/**
 * Every key in `storage` that the application itself put there.
 *
 * Returns keys rather than taking a list to check against, so a caller asserts
 * on the whole set: `expect(appStorageKeys(localStorage)).toEqual([])` fails for
 * a credential written under *any* name, where a check against four known names
 * only fails for those four.
 */
export function appStorageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key !== MSW_COOKIE_STORE_KEY) keys.push(key);
  }
  return keys.sort();
}
