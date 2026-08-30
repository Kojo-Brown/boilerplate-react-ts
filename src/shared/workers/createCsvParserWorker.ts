import type { WorkerHandle } from "@/shared/lib/csvParserClient";

/**
 * Starts the CSV parser worker.
 *
 * Three details in the two lines below are each load-bearing:
 *
 * 1. **`new URL("./csvParser.worker.ts", import.meta.url)` must be written out
 *    literally, right here.** Vite finds workers by matching this exact
 *    syntactic form at build time; it does not evaluate the expression. Hoist
 *    it into a `const url = …` one line up — or alias the specifier, or build
 *    the path from a variable — and `vite build` emits no worker chunk at all,
 *    exits 0, and leaves a `new Worker` pointing at a source path that does not
 *    exist in `dist/`. It works in `pnpm dev`, where source files are served,
 *    so the first sign of it is a 404 in production. Checked by making that
 *    edit and rebuilding: `dist/assets/csvParser.worker-*.js` disappears.
 * 2. **`type: "module"`** is what allows the worker to use `import`. Without
 *    it the browser loads the file as a classic script and fails on the first
 *    import statement; Vite's dev server serves ES modules either way, so
 *    again this is a build-only failure.
 * 3. **`name`** shows up in DevTools' thread picker. Free, and the difference
 *    between profiling a worker and guessing which one it was.
 *
 * The factory exists at all so the client can be handed something else — see
 * `csvParserClient.ts`.
 */
export function createCsvParserWorker(): WorkerHandle {
  const worker = new Worker(new URL("./csvParser.worker.ts", import.meta.url), {
    type: "module",
    name: "csv-parser",
  });

  return {
    // No cast: `Worker` already satisfies Comlink's `Endpoint` structurally, as
    // `MessagePort` does. That is what lets the tests substitute one end of a
    // `MessageChannel` for a thread without either side knowing.
    endpoint: worker,
    terminate: () => {
      worker.terminate();
    },
  };
}
