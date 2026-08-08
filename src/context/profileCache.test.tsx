import { use } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ProfileCacheContext, type ProfileCache } from "@/context/profileCache";
import { ProfileCacheProvider } from "@/context/ProfileCacheProvider";
import { createInMemoryProfileApi } from "@/lib/profileApi";
import { createPromiseCache } from "@/lib/promiseCache";

function makeCache(): ProfileCache {
  const api = createInMemoryProfileApi();
  return createPromiseCache({ load: (id: string) => api.fetchProfile(id) });
}

/** Reports what the context holds, reading it with `use()` rather than a hook. */
function CacheProbe({ skip = false }: { skip?: boolean }) {
  if (skip) return <span data-testid="probe">skipped</span>;
  const cache = use(ProfileCacheContext);
  return <span data-testid="probe">{cache === null ? "none" : `size:${cache.size()}`}</span>;
}

describe("ProfileCacheContext", () => {
  it("defaults to null outside a provider", () => {
    render(<CacheProbe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("none");
  });

  it("publishes the cache it is given", () => {
    const cache = makeCache();
    void cache.read("u-1");

    render(
      <ProfileCacheProvider cache={cache}>
        <CacheProbe />
      </ProfileCacheProvider>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("size:1");
  });

  it("allows the read to be skipped entirely", () => {
    render(
      <ProfileCacheProvider cache={makeCache()}>
        <CacheProbe skip />
      </ProfileCacheProvider>,
    );

    // An early return before `use(Context)` is legal, and is the reason the
    // context is exported raw instead of behind a hook.
    expect(screen.getByTestId("probe")).toHaveTextContent("skipped");
  });
});
