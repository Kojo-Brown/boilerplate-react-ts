import { exposeCsvParser, type CsvParserApiOptions } from "@/shared/lib/csvParserApi";
import type { WorkerHandle } from "@/shared/lib/csvParserClient";

/**
 * A stand-in for a CSV parser worker, built on a `MessageChannel`.
 *
 * jsdom implements no `Worker`, so the choice for a unit test is between this
 * and mocking Comlink. Mocking Comlink is the option that proves nothing: the
 * things that go wrong at this boundary — a function argument that cannot be
 * cloned, a proxy nobody releases, a cancel message that never gets delivered
 * because the loop only yielded a microtask — are all properties of the real
 * protocol, and a mock has none of them. A `MessageChannel` has all of them.
 * What it does not have is a second thread, which is the one thing a unit test
 * could never have checked anyway; `e2e/worker-parsing.spec.ts` covers that.
 */
export interface FakeWorker extends WorkerHandle {
  /** True once `terminate()` has been called. */
  readonly isTerminated: () => boolean;
  /** How many times `terminate()` has been called. */
  readonly terminateCount: () => number;
}

export interface FakeWorkerOptions extends CsvParserApiOptions {
  /** Called with the parser's own port, for tests that need to poke at it. */
  readonly onExpose?: (port: MessagePort) => void;
}

export function createFakeCsvWorker(options: FakeWorkerOptions = {}): FakeWorker {
  const { onExpose, ...apiOptions } = options;
  const { port1, port2 } = new MessageChannel();
  exposeCsvParser(port1, apiOptions);
  onExpose?.(port1);

  let terminateCount = 0;

  return {
    endpoint: port2,
    terminate: () => {
      terminateCount += 1;
      // A real `Worker.terminate()` tears the thread down, which closes both
      // ends of its channel. Closing both ports is the closest equivalent, and
      // it matters: a test that terminates and then calls the client again
      // should see the call hang exactly as it would in a browser.
      port1.close();
      port2.close();
    },
    isTerminated: () => terminateCount > 0,
    terminateCount: () => terminateCount,
  };
}
