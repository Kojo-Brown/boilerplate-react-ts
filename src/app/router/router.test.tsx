import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, it, expect } from "vitest";
import { routes } from "@/app/router";
import { makeStore } from "@/test/renderWithProviders";
import { actAsync } from "@/test/renderSuspense";
import { setCredentials } from "@/entities/session/authSlice";
import { isRouteHandle } from "@/features/route-announcement/routeTitle";

function renderRoute(initialPath: string, authed = false) {
  const store = makeStore();
  if (authed) {
    store.dispatch(
      setCredentials({
        token: "tok-test",
        refreshToken: "refresh-tok-test",
        expiresIn: 900,
        user: { id: "1", email: "test@example.com", role: "user" },
      }),
    );
  }
  const memoryRouter = createMemoryRouter(routes, {
    initialEntries: [initialPath],
  });
  return render(
    <Provider store={store}>
      <RouterProvider router={memoryRouter} />
    </Provider>,
  );
}

describe("router", () => {
  it("renders HomePage at /", async () => {
    renderRoute("/");
    await waitFor(() => {
      expect(screen.getByText("React TS Boilerplate")).toBeInTheDocument();
    });
  });

  it("redirects /dashboard to /login when unauthenticated", async () => {
    renderRoute("/dashboard");
    await waitFor(() => {
      expect(screen.getByText(/Sign In/)).toBeInTheDocument();
    });
  });

  it("renders DashboardPage at /dashboard when authenticated", async () => {
    renderRoute("/dashboard", true);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    });
  });

  it("renders AboutPage at /about", async () => {
    renderRoute("/about");
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "About" })).toBeInTheDocument();
    });
  });

  it("renders LoginPage at /login", async () => {
    renderRoute("/login");
    await waitFor(() => {
      expect(screen.getByText("Sign In")).toBeInTheDocument();
    });
  });

  it("renders ConcurrencyLabPage at /labs/concurrency", async () => {
    // A small dataset keeps this a routing assertion; the page's own tests and
    // the Playwright benchmark cover it at full size.
    renderRoute("/labs/concurrency?n=10");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Concurrency Lab" }),
      ).toBeInTheDocument();
    });
  });

  it("renders OptimisticLabPage at /labs/optimistic", async () => {
    renderRoute("/labs/optimistic?latency=0");
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Optimistic Lab" })).toBeInTheDocument();
    });
  });

  it("renders ActionsLabPage at /labs/actions", async () => {
    renderRoute("/labs/actions?latency=0");
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Actions Lab" })).toBeInTheDocument();
    });
  });

  it("renders StreamingLabPage at /labs/streaming", async () => {
    // The report suspends on its first pass, so the initial render has to sit
    // inside an awaited act scope or its retry is stranded — see
    // `renderSuspense.tsx`. The other lab routes resolve through `lazy()`,
    // which does not hit that.
    await actAsync(async () => {
      renderRoute("/labs/streaming?latency=0");
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Streaming Suspense Lab" }),
      ).toBeInTheDocument();
    });
  });

  it("renders HeadlessLabPage at /labs/headless", async () => {
    renderRoute("/labs/headless");
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Headless Lab" })).toBeInTheDocument();
    });
  });

  it("renders RenderPropsLabPage at /labs/render-props", async () => {
    renderRoute("/labs/render-props");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "Render Props & HOCs Lab" }),
      ).toBeInTheDocument();
    });
  });

  it("renders NotFoundPage for unknown routes", async () => {
    renderRoute("/this-does-not-exist");
    await waitFor(() => {
      expect(screen.getByText("404")).toBeInTheDocument();
    });
  });
});

/**
 * Every route that renders a page declares the name that page is announced by.
 *
 * `<RouteAnnouncer>` reads it through `useMatches`, and the failure mode
 * without this test is the quiet one: a new route is added, its handle is
 * forgotten, and the only symptom is that arriving there says nothing and
 * leaves the tab titled "React TS". Nobody sees that in review, and nobody
 * using a mouse ever sees it at all.
 *
 * Layout routes are exempt by construction — `children` is the test for one —
 * because a shell has no name that is true of the pages inside it.
 */
function leafRoutes(
  routeObjects: readonly RouteObject[],
  trail: string[] = [],
): [string, RouteObject][] {
  return routeObjects.flatMap((route): [string, RouteObject][] => {
    const path = [...trail, route.path ?? (route.index === true ? "(index)" : "(layout)")];
    if (route.children !== undefined) return leafRoutes(route.children, path);
    return [[path.join(" > "), route]];
  });
}

describe("route handles", () => {
  it("finds every leaf in the config", () => {
    // A guard on the walker rather than on the app: a bug that made this
    // return nothing would make the assertion below vacuously true.
    expect(leafRoutes(routes).length).toBeGreaterThan(20);
  });

  it.each(leafRoutes(routes))("%s declares a title", (_name, route) => {
    expect(isRouteHandle(route.handle)).toBe(true);
  });
});
