import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { ProfilePanel } from "@/components/suspense/ProfilePanel";
import { ProfileCacheProvider } from "@/context/ProfileCacheProvider";
import type { ProfileCache } from "@/context/profileCache";
import { createInMemoryProfileApi, type UserProfile } from "@/lib/profileApi";
import { createPromiseCache } from "@/lib/promiseCache";
import { actAsync, renderAsync } from "@/test/renderSuspense";

const profiles: readonly UserProfile[] = [
  {
    id: "u-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "admin",
    joinedAt: "2024-03-11",
  },
];

/** A cache whose backing service fails for the first `failures` requests. */
function flakyCache(failures: number): { cache: ProfileCache; requestCount: () => number } {
  let seen = 0;
  const api = createInMemoryProfileApi({
    profiles,
    failWhen: () => {
      seen += 1;
      return seen <= failures ? "Service unavailable" : null;
    },
  });
  return {
    cache: createPromiseCache({ load: (id: string) => api.fetchProfile(id) }),
    requestCount: () => api.requestCount(),
  };
}

let consoleErrorSpy: MockInstance<(...args: unknown[]) => void>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("ProfilePanel", () => {
  it("renders the profile once it arrives", async () => {
    // Slow enough that the request is still in flight when the initial render
    // settles, so the fallback is observable.
    const api = createInMemoryProfileApi({ profiles, latencyMs: 50 });
    const cache = createPromiseCache({ load: (id: string) => api.fetchProfile(id) });

    await renderAsync(
      <ProfileCacheProvider cache={cache}>
        <ProfilePanel userId="u-1" />
      </ProfileCacheProvider>,
    );

    expect(screen.getByTestId("user-profile-card-skeleton")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.queryByTestId("profile-error")).not.toBeInTheDocument();
  });

  it("catches a rejected request and offers a retry", async () => {
    const { cache } = flakyCache(Number.POSITIVE_INFINITY);

    await renderAsync(
      <ProfileCacheProvider cache={cache}>
        <ProfilePanel userId="u-1" />
      </ProfileCacheProvider>,
    );

    const alert = await screen.findByTestId("profile-error");
    expect(alert).toHaveTextContent("Could not load u-1.");
    expect(alert).toHaveTextContent("Service unavailable");
    expect(screen.getByTestId("retry-profile")).toBeInTheDocument();
  });

  it("recovers when the retry succeeds", async () => {
    const user = userEvent.setup();
    const { cache, requestCount } = flakyCache(1);

    await renderAsync(
      <ProfileCacheProvider cache={cache}>
        <ProfilePanel userId="u-1" />
      </ProfileCacheProvider>,
    );

    await screen.findByTestId("profile-error");
    await actAsync(() => user.click(screen.getByTestId("retry-profile")));

    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(screen.queryByTestId("profile-error")).not.toBeInTheDocument();
    // Retry means a second request, which only happens because the rejected
    // entry was invalidated before the boundary reset.
    expect(requestCount()).toBe(2);
  });

  it("re-shows the error when the retry fails again", async () => {
    const user = userEvent.setup();
    const { cache, requestCount } = flakyCache(2);

    await renderAsync(
      <ProfileCacheProvider cache={cache}>
        <ProfilePanel userId="u-1" />
      </ProfileCacheProvider>,
    );

    await screen.findByTestId("profile-error");
    await actAsync(() => user.click(screen.getByTestId("retry-profile")));

    expect(await screen.findByTestId("profile-error")).toHaveTextContent("Service unavailable");
    expect(requestCount()).toBe(2);
  });

  it("does not retry without invalidating: the sticky rejection is the reason retry has to be explicit", async () => {
    const { cache } = flakyCache(1);

    // Drive the failure once, then reset nothing — the entry is still the
    // rejected promise, so a plain re-read hands back the same failure rather
    // than a fresh request. `ProfilePanel` calls `invalidate` for exactly this.
    await expect(cache.read("u-1")).rejects.toThrow("Service unavailable");
    expect(cache.read("u-1")).toBe(cache.read("u-1"));
    await expect(cache.read("u-1")).rejects.toThrow("Service unavailable");
  });

  it("accepts an explicit cache without a provider", async () => {
    const api = createInMemoryProfileApi({ profiles });
    const cache = createPromiseCache({ load: (id: string) => api.fetchProfile(id) });

    await renderAsync(<ProfilePanel userId="u-1" cache={cache} />);

    expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  });

  it("surfaces the missing-cache error through its own boundary", async () => {
    await renderAsync(<ProfilePanel userId="u-1" />);

    expect(await screen.findByTestId("profile-error")).toHaveTextContent(/needs a profile cache/);
  });

  it("isolates failures to one panel", async () => {
    const api = createInMemoryProfileApi({
      profiles: [
        ...profiles,
        {
          id: "u-2",
          name: "Grace Hopper",
          email: "grace@example.com",
          role: "user",
          joinedAt: "2024-07-02",
        },
      ],
      failWhen: (id) => (id === "u-2" ? "Service unavailable" : null),
    });
    const cache = createPromiseCache({ load: (id: string) => api.fetchProfile(id) });

    await renderAsync(
      <ProfileCacheProvider cache={cache}>
        <ProfilePanel userId="u-1" />
        <ProfilePanel userId="u-2" />
      </ProfileCacheProvider>,
    );

    // Per-panel boundaries: the broken one shows its error, the healthy one
    // still renders. Hoisting the boundaries would have blanked both.
    expect(await screen.findByTestId("profile-error")).toHaveTextContent("Could not load u-2.");
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  });
});
