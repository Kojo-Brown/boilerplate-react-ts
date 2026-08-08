import { act } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

export interface RenderSuspenseResult extends RenderResult {
  /** `rerender`, wrapped the same way. Use it if the new tree can suspend too. */
  rerenderAsync: (ui: ReactElement) => Promise<void>;
}

/**
 * `render`, for a tree that suspends on the very first pass.
 *
 * Testing Library's `render` wraps the initial render in a **synchronous**
 * `act()`. A component that suspends inside a non-awaited act scope leaves its
 * retry queued in that scope, and the scope closes before anything can flush
 * it — so the promise resolves, React marks it fulfilled, and the fallback
 * stays on screen forever. The test then fails on a `waitFor` timeout with no
 * error and no warning beyond React's "a component suspended inside an `act`
 * scope, but the `act` call was not awaited".
 *
 * `lazy()` does not hit this, which is why the router tests have never needed
 * it — its retry goes through a different path. `use()` does hit it, every
 * time. So every `use()` test renders through here.
 *
 * Awaiting the act scope does *not* wait out a pending timer, so a fallback is
 * still observable after this returns as long as the request has not settled;
 * assertions on the resolved UI still go through `findBy*`/`waitFor` as usual.
 *
 * Usage:
 *   const { rerenderAsync } = await renderAsync(<Suspense …><Card /></Suspense>);
 */
export async function renderAsync(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
): Promise<RenderSuspenseResult> {
  let result!: RenderResult;

  await act(async () => {
    result = render(ui, options);
    // The scope has to be async for `act` to flush the work the suspension
    // queued; a synchronous callback would put us straight back where we
    // started. Yielding a microtask is the smallest way to say so.
    await Promise.resolve();
  });

  return {
    ...result,
    rerenderAsync: async (next) => {
      await act(async () => {
        result.rerender(next);
        await Promise.resolve();
      });
    },
  };
}

/**
 * Runs an interaction that pushes the tree back into a fallback.
 *
 * Same hazard as {@link renderAsync}, one step later: a click that makes a
 * component suspend again — a retry, a filter change, anything that reaches a
 * cache entry that is not there yet — strands its retry unless the whole
 * interaction sits inside an awaited act scope. `userEvent`'s own wrapping is
 * not enough; the symptom is again a `waitFor` timeout on a fallback that never
 * resolves.
 *
 * Interactions that cannot suspend do not need this.
 *
 * Usage:
 *   await actAsync(() => user.click(screen.getByTestId("retry-profile")));
 */
export async function actAsync(action: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await action();
  });
}
