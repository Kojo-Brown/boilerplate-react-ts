import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { RoutePrefetchProvider, useRoutePrefetch } from "@/features/route-prefetch/routePrefetch";
import { usePrefetchSnapshot } from "@/features/route-prefetch/usePrefetchSnapshot";
import { createManualIdleScheduler, createStubChunkRegistry } from "@/test/prefetch";

const ABOUT = "/about";
const DASH = "/dashboard";

function setup({ shouldPrefetch }: { shouldPrefetch?: () => boolean } = {}) {
  const scheduler = createManualIdleScheduler();
  const chunks = createStubChunkRegistry([ABOUT, DASH]);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <RoutePrefetchProvider
        registry={chunks.registry}
        scheduler={scheduler}
        {...(shouldPrefetch !== undefined && { shouldPrefetch })}
      >
        {children}
      </RoutePrefetchProvider>
    );
  }

  return { scheduler, chunks, Wrapper };
}

describe("useRoutePrefetch", () => {
  it("throws outside a provider rather than quietly doing nothing", () => {
    // A no-op default would be indistinguishable from prefetching that works:
    // every page still loads, just later, and no test could tell.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => renderHook(() => useRoutePrefetch())).toThrow(/RoutePrefetchProvider/);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("loads a requested route once the browser goes idle", () => {
    const { scheduler, chunks, Wrapper } = setup();
    const { result } = renderHook(() => useRoutePrefetch(), { wrapper: Wrapper });

    act(() => {
      result.current.request(ABOUT, "hover");
    });

    expect(chunks.calls).toEqual([]);
    expect(result.current.stateOf(ABOUT)).toBe("queued");

    scheduler.flush();

    expect(chunks.calls).toEqual([ABOUT]);
  });

  it("consults shouldPrefetch on every request, not once at mount", () => {
    let allowed = false;
    const { scheduler, chunks, Wrapper } = setup({ shouldPrefetch: () => allowed });
    const { result } = renderHook(() => useRoutePrefetch(), { wrapper: Wrapper });

    act(() => {
      result.current.request(ABOUT, "hover");
    });
    scheduler.flush();
    expect(chunks.calls).toEqual([]);

    // The connection improved. Nothing remounted.
    allowed = true;
    act(() => {
      result.current.request(ABOUT, "hover");
    });
    scheduler.flush();
    expect(chunks.calls).toEqual([ABOUT]);
  });

  it("still withdraws a request when prefetching has since been disallowed", () => {
    let allowed = true;
    const { scheduler, chunks, Wrapper } = setup({ shouldPrefetch: () => allowed });
    const { result } = renderHook(() => useRoutePrefetch(), { wrapper: Wrapper });

    act(() => {
      result.current.request(ABOUT, "hover");
    });
    allowed = false;
    act(() => {
      result.current.cancel(ABOUT);
    });

    scheduler.flush();
    expect(chunks.calls).toEqual([]);
    expect(result.current.stateOf(ABOUT)).toBe("unrequested");
  });

  it("stops draining the queue when the provider unmounts", () => {
    const { scheduler, chunks, Wrapper } = setup();
    const { result, unmount } = renderHook(() => useRoutePrefetch(), { wrapper: Wrapper });

    act(() => {
      result.current.request(ABOUT, "hover");
    });
    unmount();
    scheduler.flush();

    expect(chunks.calls).toEqual([]);
  });

  it("keeps prefetching under StrictMode's mount, unmount, mount", () => {
    // The failure this exists to catch is development-only and silent: an
    // irreversible teardown in the provider's effect cleanup kills the queue
    // on the first commit, and hovering a link then queues an entry that
    // nothing ever drains. Every other test in this file mounts without
    // StrictMode and so cannot see it — `e2e/route-prefetch.spec.ts` is what
    // found it.
    const scheduler = createManualIdleScheduler();
    const chunks = createStubChunkRegistry([ABOUT, DASH]);

    function StrictWrapper({ children }: { children: ReactNode }) {
      return (
        <StrictMode>
          <RoutePrefetchProvider registry={chunks.registry} scheduler={scheduler}>
            {children}
          </RoutePrefetchProvider>
        </StrictMode>
      );
    }

    const { result } = renderHook(() => useRoutePrefetch(), { wrapper: StrictWrapper });

    act(() => {
      result.current.request(ABOUT, "hover");
    });
    scheduler.flush();

    expect(chunks.calls).toEqual([ABOUT]);
  });
});

describe("usePrefetchSnapshot", () => {
  it("follows an entry from queued to loading to loaded", async () => {
    const { scheduler, chunks, Wrapper } = setup();
    const { result } = renderHook(
      () => ({ controller: useRoutePrefetch(), snapshot: usePrefetchSnapshot() }),
      { wrapper: Wrapper },
    );

    expect(result.current.snapshot.queued).toEqual([]);

    act(() => {
      result.current.controller.request(ABOUT, "hover");
    });
    expect(result.current.snapshot.queued).toEqual([ABOUT]);

    scheduler.flush();
    expect(result.current.snapshot.queued).toEqual([]);
    expect(result.current.snapshot.loading).toEqual([ABOUT]);

    await chunks.resolve(ABOUT);
    expect(result.current.snapshot.loading).toEqual([]);
    expect(result.current.snapshot.loaded).toEqual([ABOUT]);
  });

  it("hands back the same snapshot when nothing changed", () => {
    // `useSyncExternalStore` compares snapshots by identity: one rebuilt on
    // every read would re-render forever rather than merely too often.
    const { Wrapper } = setup();
    const { result } = renderHook(
      () => ({ controller: useRoutePrefetch(), snapshot: usePrefetchSnapshot() }),
      { wrapper: Wrapper },
    );

    const before = result.current.snapshot;

    act(() => {
      // Not in the registry, so the queue drops it and notifies nobody.
      result.current.controller.request("/nowhere", "hover");
    });

    expect(result.current.snapshot).toBe(before);
  });
});
