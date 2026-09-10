/**
 * Getting a heap snapshot out of a live page, and getting it at a moment that
 * means something.
 *
 * `HeapProfiler.takeHeapSnapshot` does not return the snapshot. It streams it
 * as a sequence of `HeapProfiler.addHeapSnapshotChunk` events and resolves the
 * command once the last one has been emitted — so a caller that awaits the
 * command without having subscribed first gets an empty string and no error.
 * That is the single most common way this measurement silently reports a heap
 * with no detached nodes in it.
 *
 * The session is typed against the two methods used rather than Playwright's
 * `CDPSession`, so the sequencing above is unit-testable against a scripted
 * fake. Playwright's real session satisfies the interface structurally.
 */

/** The slice of Playwright's `CDPSession` this module needs. */
export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (payload: { chunk: string }) => void): void;
  off(event: string, handler: (payload: { chunk: string }) => void): void;
}

export interface CaptureOptions {
  /**
   * Whether V8 should compute retained sizes while walking the heap.
   *
   * Off by default. It roughly doubles snapshot time on a page this size and
   * nothing here reads the numbers — `shortestRetainerPath` answers "who is
   * holding this", which is the question that gets a leak fixed, and it needs
   * the edges rather than the sizes.
   */
  readonly captureNumericValue?: boolean;
}

/**
 * Collects one heap snapshot as raw JSON text.
 *
 * The chunk handler is attached before the command is sent and detached in a
 * `finally`, so a failed capture does not leave a listener that appends the
 * *next* capture's chunks to this one's buffer — a corruption that shows up
 * much later as an unparseable snapshot.
 */
export async function captureHeapSnapshot(
  session: CdpSessionLike,
  options: CaptureOptions = {},
): Promise<string> {
  const chunks: string[] = [];
  const onChunk = (payload: { chunk: string }): void => {
    chunks.push(payload.chunk);
  };

  await session.send("HeapProfiler.enable");
  session.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    await session.send("HeapProfiler.takeHeapSnapshot", {
      reportProgress: false,
      captureNumericValue: options.captureNumericValue ?? false,
    });
  } finally {
    session.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  }

  return chunks.join("");
}

/**
 * Runs a full GC and waits for the collector to have finished.
 *
 * Every measurement in this audit is "what is still alive after collection",
 * so this is not an optimisation — without it the numbers include garbage that
 * simply had not been collected yet, which varies run to run and makes the
 * gate flaky in the direction of false failures.
 *
 * `HeapProfiler.collectGarbage` is synchronous from CDP's point of view but
 * V8 finishes some work in following tasks, so the caller is given a chance to
 * yield afterwards. `takeHeapSnapshot` also collects before it walks, which is
 * belt and braces on purpose: the two are cheap next to being wrong.
 */
export async function collectGarbage(session: CdpSessionLike): Promise<void> {
  await session.send("HeapProfiler.enable");
  await session.send("HeapProfiler.collectGarbage");
}
