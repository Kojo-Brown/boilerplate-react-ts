import { Suspense } from "react";
import { screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { UserProfileCard, UserProfileCardSkeleton } from "@/entities/user/UserProfileCard";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { ProfileCacheProvider } from "@/entities/user/ProfileCacheProvider";
import type { ProfileCache } from "@/entities/user/profileCache";
import {
  createInMemoryProfileApi,
  type ProfileApi,
  type UserProfile,
} from "@/entities/user/profileApi";
import { createPromiseCache } from "@/shared/lib/promiseCache";
import { actAsync, renderAsync } from "@/test/renderSuspense";
import { createDeferredProfileApi } from "@/test/profileHarness";

const ADA: UserProfile = {
  id: "u-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  role: "admin",
  joinedAt: "2024-03-11",
};

const GRACE: UserProfile = {
  id: "u-2",
  name: "Grace Hopper",
  email: "grace@example.com",
  role: "user",
  joinedAt: "2024-07-02",
};

const profiles: readonly UserProfile[] = [ADA, GRACE];

function makeCache(api: ProfileApi): ProfileCache {
  return createPromiseCache({ load: (id: string) => api.fetchProfile(id) });
}

function healthy(latencyMs = 0): { api: ProfileApi; cache: ProfileCache } {
  const api = createInMemoryProfileApi({ profiles, latencyMs });
  return { api, cache: makeCache(api) };
}

// React logs every error it hands to a boundary. Some tests below cause them
// deliberately, so the noise is silenced rather than tolerated.
let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("UserProfileCard", () => {
  it("shows the fallback first, then the profile", async () => {
    // Gated rather than slow. Holding the fallback open with a timer means the
    // initial render has to finish inside that window, and on a loaded runner
    // it does not — this test failed in CI that way. Nothing settles until
    // `resolve` is called, so there is no window to lose.
    const api = createDeferredProfileApi();
    const cache = makeCache(api);
    await renderAsync(
      <ProfileCacheProvider cache={cache}>
        <Suspense fallback={<UserProfileCardSkeleton />}>
          <UserProfileCard userId="u-1" />
        </Suspense>
      </ProfileCacheProvider>,
    );

    // The card is written with no loading branch of its own — this fallback is
    // Suspense's, not the component's.
    expect(screen.getByTestId("user-profile-card-skeleton")).toBeInTheDocument();

    await actAsync(() => api.resolve("u-1", ADA));

    expect(screen.getByTestId("user-profile-card")).toHaveAttribute("data-user-id", "u-1");
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.queryByTestId("user-profile-card-skeleton")).not.toBeInTheDocument();
  });

  it("reads the cache from context", async () => {
    const { api, cache } = healthy();
    await renderAsync(
      <ProfileCacheProvider cache={cache}>
        <Suspense fallback={<UserProfileCardSkeleton />}>
          <UserProfileCard userId="u-2" />
        </Suspense>
      </ProfileCacheProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Grace Hopper" })).toBeInTheDocument();
    expect(api.requestCount()).toBe(1);
  });

  it("skips the context read entirely when a cache prop is given", async () => {
    const fromContext = healthy();
    const fromProp = healthy();

    await renderAsync(
      <ProfileCacheProvider cache={fromContext.cache}>
        <Suspense fallback={<UserProfileCardSkeleton />}>
          <UserProfileCard userId="u-1" cache={fromProp.cache} />
        </Suspense>
      </ProfileCacheProvider>,
    );

    await screen.findByTestId("user-profile-card");

    // `cache ?? use(Context)` short-circuits, so the provider's cache is never
    // touched. This is the behaviour `useContext` could not express.
    expect(fromProp.api.requestCount()).toBe(1);
    expect(fromContext.api.requestCount()).toBe(0);
    expect(fromContext.cache.size()).toBe(0);
  });

  it("throws a usable error when rendered with no cache at all", async () => {
    await renderAsync(
      <ErrorBoundary>
        <Suspense fallback={<UserProfileCardSkeleton />}>
          <UserProfileCard userId="u-1" />
        </Suspense>
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/needs a profile cache/)).toBeInTheDocument();
  });

  it("rethrows a rejected promise to the nearest error boundary", async () => {
    const api = createInMemoryProfileApi({ profiles, failWhen: () => "Service unavailable" });
    await renderAsync(
      <ProfileCacheProvider cache={makeCache(api)}>
        <ErrorBoundary>
          <Suspense fallback={<UserProfileCardSkeleton />}>
            <UserProfileCard userId="u-1" />
          </Suspense>
        </ErrorBoundary>
      </ProfileCacheProvider>,
    );

    expect(await screen.findByText("Service unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("user-profile-card")).not.toBeInTheDocument();
  });

  it("rethrows for an id the service does not know", async () => {
    const { cache } = healthy();
    await renderAsync(
      <ProfileCacheProvider cache={cache}>
        <ErrorBoundary>
          <Suspense fallback={<UserProfileCardSkeleton />}>
            <UserProfileCard userId="u-404" />
          </Suspense>
        </ErrorBoundary>
      </ProfileCacheProvider>,
    );

    expect(await screen.findByText("No profile with id u-404")).toBeInTheDocument();
  });

  it("does not re-request when the tree re-renders", async () => {
    const { api, cache } = healthy();
    const tree = (
      <ProfileCacheProvider cache={cache}>
        <Suspense fallback={<UserProfileCardSkeleton />}>
          <UserProfileCard userId="u-1" />
        </Suspense>
      </ProfileCacheProvider>
    );

    const { rerenderAsync } = await renderAsync(tree);
    await screen.findByTestId("user-profile-card");

    await rerenderAsync(tree);
    await rerenderAsync(tree);
    await waitFor(() => {
      expect(screen.getByTestId("user-profile-card")).toBeInTheDocument();
    });

    // The cache is what makes this true. Calling `api.fetchProfile` in render
    // would have issued a request per pass and never left the fallback.
    expect(api.requestCount()).toBe(1);
  });

  it("renders siblings independently when each has its own boundary", async () => {
    const api = createInMemoryProfileApi({
      profiles,
      failWhen: (id) => (id === "u-2" ? "Service unavailable" : null),
    });

    await renderAsync(
      <ProfileCacheProvider cache={makeCache(api)}>
        <ErrorBoundary>
          <Suspense fallback={<UserProfileCardSkeleton />}>
            <UserProfileCard userId="u-1" />
          </Suspense>
        </ErrorBoundary>
        <ErrorBoundary>
          <Suspense fallback={<UserProfileCardSkeleton />}>
            <UserProfileCard userId="u-2" />
          </Suspense>
        </ErrorBoundary>
      </ProfileCacheProvider>,
    );

    expect(await screen.findByText("Service unavailable")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  });
});

describe("UserProfileCardSkeleton", () => {
  it("announces loading once and hides its bars from assistive tech", async () => {
    const { container } = await renderAsync(<UserProfileCardSkeleton />);

    expect(screen.getByRole("status", { name: "Loading profile" })).toBeInTheDocument();
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(3);
  });
});
