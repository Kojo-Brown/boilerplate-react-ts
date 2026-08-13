import { Suspense, lazy, useState, useTransition, type ReactElement } from "react";
import {
  Outlet,
  RouterProvider,
  createMemoryRouter,
  useNavigate,
  useNavigation,
  type RouteObject,
} from "react-router";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";

/**
 * The React and React Router behaviours the route-transition design rests on.
 *
 * These are not tests of our components — they are the load-bearing claims
 * underneath them, written against React and React Router directly so that a
 * version bump which changes one of them fails here, loudly, instead of
 * quietly turning `<RoutePendingBar>` into a component that never appears.
 *
 * Every arm gates its own suspension. Driving these on latency would assert
 * whichever ordering the machine happened to produce.
 */

interface Chunk {
  Component: React.LazyExoticComponent<() => ReactElement>;
  resolve: () => void;
  settled: Promise<unknown>;
}

/** A `React.lazy` chunk that arrives only when the test says so. */
function deferredChunk(text: string): Chunk {
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

/** Lets React process the click and start the navigation, without settling it. */
async function clickAndSettleMicrotasks(label: string): Promise<void> {
  await act(async () => {
    screen.getByText(label).click();
    await Promise.resolve();
  });
}

type BoundaryPlacement = "hoisted" | "per-route";

function buildRoutes(chunk: Chunk, placement: BoundaryPlacement): RouteObject[] {
  const destination =
    placement === "per-route" ? (
      <Suspense fallback={<div>SKELETON</div>}>
        <chunk.Component />
      </Suspense>
    ) : (
      <chunk.Component />
    );

  return [
    {
      path: "/",
      element: <BehaviourLayout placement={placement} />,
      children: [
        { index: true, element: <div>PREVIOUS PAGE</div> },
        { path: "next", element: destination },
      ],
    },
  ];
}

function BehaviourLayout({ placement }: { placement: BoundaryPlacement }) {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [isPending, startTransition] = useTransition();
  const [clicks, setClicks] = useState(0);

  const outlet =
    placement === "hoisted" ? (
      <Suspense fallback={<div>SKELETON</div>}>
        <Outlet />
      </Suspense>
    ) : (
      <Outlet />
    );

  return (
    <div>
      <button
        onClick={() => {
          startTransition(async () => {
            await navigate("/next");
          });
        }}
      >
        go
      </button>
      <button
        onClick={() => {
          setClicks((current) => current + 1);
        }}
      >
        clicks:{clicks}
      </button>
      <span data-testid="transition-pending">{isPending ? "pending" : "idle"}</span>
      <span data-testid="router-navigation-state">{navigation.state}</span>
      {outlet}
    </div>
  );
}

async function startNavigation(placement: BoundaryPlacement): Promise<Chunk> {
  const chunk = deferredChunk("NEXT PAGE");
  const router = createMemoryRouter(buildRoutes(chunk, placement), { initialEntries: ["/"] });
  render(<RouterProvider router={router} />);
  expect(screen.getByText("PREVIOUS PAGE")).toBeInTheDocument();
  await clickAndSettleMicrotasks("go");
  return chunk;
}

describe("route transition behaviour: where the Suspense boundary lives", () => {
  it("keeps the previous page when the boundary is hoisted above the outlet", async () => {
    const chunk = await startNavigation("hoisted");

    expect(screen.getByText("PREVIOUS PAGE")).toBeInTheDocument();
    expect(screen.queryByText("SKELETON")).not.toBeInTheDocument();

    await act(async () => {
      chunk.resolve();
      await chunk.settled;
    });
    expect(screen.getByText("NEXT PAGE")).toBeInTheDocument();
  });

  it("loses the previous page when the boundary is inside the route element", async () => {
    // The regression this whole design exists to prevent: a boundary added to
    // a single route element re-introduces the flash for that route alone, and
    // nothing in the route config makes it visible.
    const chunk = await startNavigation("per-route");

    expect(screen.queryByText("PREVIOUS PAGE")).not.toBeInTheDocument();
    expect(screen.getByText("SKELETON")).toBeInTheDocument();

    await act(async () => {
      chunk.resolve();
      await chunk.settled;
    });
    expect(screen.getByText("NEXT PAGE")).toBeInTheDocument();
  });

  it("reports pending only while the previous page is actually being held", async () => {
    // `isPending` is a consequence of the hold rather than an independent
    // signal: a boundary that commits its fallback has finished the
    // transition, so a per-route boundary yields no pending state to render.
    const heldChunk = await startNavigation("hoisted");
    expect(screen.getByTestId("transition-pending")).toHaveTextContent("pending");
    await act(async () => {
      heldChunk.resolve();
      await heldChunk.settled;
    });
    expect(screen.getByTestId("transition-pending")).toHaveTextContent("idle");
  });

  it("leaves the held page interactive, not merely painted", async () => {
    const chunk = await startNavigation("hoisted");

    expect(screen.getByText("clicks:0")).toBeInTheDocument();
    await act(async () => {
      screen.getByText("clicks:0").click();
      await Promise.resolve();
    });

    // An urgent update lands during the held transition: the previous page is
    // still mounted and still processing events, which is the difference
    // between holding a page and freezing one.
    expect(screen.getByText("clicks:1")).toBeInTheDocument();
    expect(screen.getByText("PREVIOUS PAGE")).toBeInTheDocument();

    await act(async () => {
      chunk.resolve();
      await chunk.settled;
    });
  });

  it("leaves the router's own navigation state idle for a lazy chunk", async () => {
    // Why `useNavigation()` cannot drive the pending bar. It tracks loaders,
    // and a `React.lazy` element is not one — as far as the router is
    // concerned this navigation finished the moment it started.
    const chunk = await startNavigation("hoisted");
    expect(screen.getByTestId("router-navigation-state")).toHaveTextContent("idle");
    await act(async () => {
      chunk.resolve();
      await chunk.settled;
    });
  });
});

describe("route transition behaviour: the await inside startTransition", () => {
  function LoaderLayout({ mode }: { mode: "sync" | "async" }) {
    const navigate = useNavigate();
    const [isPending, startTransition] = useTransition();
    return (
      <div>
        <button
          onClick={() => {
            if (mode === "async") {
              startTransition(async () => {
                await navigate("/next");
              });
            } else {
              startTransition(() => {
                void navigate("/next");
              });
            }
          }}
        >
          go
        </button>
        <span data-testid="transition-pending">{isPending ? "pending" : "idle"}</span>
        <Suspense fallback={<div>SKELETON</div>}>
          <Outlet />
        </Suspense>
      </div>
    );
  }

  async function navigateThroughLoader(mode: "sync" | "async") {
    let releaseLoader!: () => void;
    const loaderGate = new Promise<void>((resolve) => {
      releaseLoader = resolve;
    });

    const routes: RouteObject[] = [
      {
        path: "/",
        element: <LoaderLayout mode={mode} />,
        children: [
          { index: true, element: <div>PREVIOUS PAGE</div> },
          {
            path: "next",
            loader: async () => {
              await loaderGate;
              return null;
            },
            element: <div>NEXT PAGE</div>,
          },
        ],
      },
    ];

    const router = createMemoryRouter(routes, { initialEntries: ["/"] });
    render(<RouterProvider router={router} />);
    await clickAndSettleMicrotasks("go");
    return { releaseLoader, loaderGate };
  }

  it("reports pending when the navigation is awaited inside the transition", async () => {
    const { releaseLoader, loaderGate } = await navigateThroughLoader("async");
    expect(screen.getByTestId("transition-pending")).toHaveTextContent("pending");
    await act(async () => {
      releaseLoader();
      await loaderGate;
    });
    expect(screen.getByText("NEXT PAGE")).toBeInTheDocument();
  });

  it("never reports pending when the navigation is not awaited", async () => {
    // The failure mode this pins is silent. `startTransition(() => navigate())`
    // still navigates, and with lazy-only routes it even still holds the page —
    // the router runs its own transition internally. What it never does is
    // report pending, because `navigate` returns before the router touches any
    // React state and the synchronous scope has already closed. Give one route
    // a loader and the progress bar simply stops appearing, with nothing
    // failing to explain why.
    const { releaseLoader, loaderGate } = await navigateThroughLoader("sync");
    expect(screen.getByTestId("transition-pending")).toHaveTextContent("idle");
    await act(async () => {
      releaseLoader();
      await loaderGate;
    });
    expect(screen.getByText("NEXT PAGE")).toBeInTheDocument();
  });
});
