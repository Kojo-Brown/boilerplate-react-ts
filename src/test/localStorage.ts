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
    return this.#entries.get(String(key)) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#entries.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.#entries.delete(String(key));
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
