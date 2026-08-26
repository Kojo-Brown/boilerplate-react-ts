import { Suspense, lazy, type ReactElement, type ReactNode } from "react";
import { Outlet, RouterProvider, createMemoryRouter, type RouteObject } from "react-router";
import { act, render } from "@testing-library/react";
import { RouteTransitionProvider } from "@/features/route-transition/routeTransition";

export interface DeferredChunk {
  Component: React.LazyExoticComponent<() => ReactElement>;
  /** Lets the destination arrive, ending the hold. */
  resolve: () => void;
  settled: Promise<unknown>;
}

/**
 * A `React.lazy` chunk that arrives only when the test says so.
 *
 * Holding a navigation open is the only way to observe pending UI, and a real
 * chunk settles too fast to catch. Gating it explicitly also keeps the
 * assertions off the clock: a latency-driven version asserts on whichever
 * ordering the machine produced that run.
 */
export function deferredChunk(text: string): DeferredChunk {
  let resolveChunk!: () => void;
  const settled = new Promise<{ default: () => ReactElement }>((resolvePromise) => {
    resolveChunk = () => {
      resolvePromise({ default: () => <div>{text}</div> });
    };
  });
  return {
    Component: lazy(() => settled),
    resolve: () => {
      resolveChunk();
    },
    settled,
  };
}

export interface HeldNavigationAppOptions {
  /** Rendered in the layout, above the outlet — the navigation UI under test. */
  chrome: ReactNode;
  /** Text of the route that is left behind. */
  previousText?: string;
  /** Text of the route being navigated to. */
  nextText?: string;
}

export interface HeldNavigationApp {
  chunk: DeferredChunk;
  /** Resolves the destination and flushes, ending the hold. */
  arrive: () => Promise<void>;
}

/**
 * A two-route app whose second route can be held open indefinitely.
 *
 * The boundary is hoisted above `<Outlet>` because that is the configuration
 * being tested: with a boundary inside the route element there is no hold, and
 * therefore no pending state for any of this chrome to render.
 */
export function renderHeldNavigationApp({
  chrome,
  previousText = "PREVIOUS PAGE",
  nextText = "NEXT PAGE",
}: HeldNavigationAppOptions): HeldNavigationApp {
  const chunk = deferredChunk(nextText);

  const routes: RouteObject[] = [
    {
      path: "/",
      element: (
        <RouteTransitionProvider>
          {chrome}
          <Suspense fallback={<div>FALLBACK</div>}>
            <Outlet />
          </Suspense>
        </RouteTransitionProvider>
      ),
      children: [
        { index: true, element: <div>{previousText}</div> },
        { path: "next", element: <chunk.Component /> },
      ],
    },
  ];

  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />);

  return {
    chunk,
    arrive: async () => {
      await act(async () => {
        chunk.resolve();
        await chunk.settled;
      });
    },
  };
}

/** Clicks and lets the transition start, without letting it finish. */
export async function clickAndHold(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
}
