import { describe, it, expect } from "vitest";
import {
  createInMemoryProfileApi,
  DEMO_PROFILES,
  ProfileApiError,
  type UserProfile,
} from "@/lib/profileApi";

const profiles: readonly UserProfile[] = [
  { id: "u-1", name: "Ada", email: "ada@example.com", role: "admin", joinedAt: "2024-01-01" },
  { id: "u-2", name: "Grace", email: "grace@example.com", role: "user", joinedAt: "2024-02-02" },
];

describe("createInMemoryProfileApi", () => {
  it("resolves a seeded profile by id", async () => {
    const api = createInMemoryProfileApi({ profiles });

    await expect(api.fetchProfile("u-2")).resolves.toEqual(profiles[1]);
  });

  it("defaults to the demo profiles", async () => {
    const api = createInMemoryProfileApi();

    await expect(api.fetchProfile("u-1")).resolves.toEqual(DEMO_PROFILES[0]);
  });

  it("rejects with a ProfileApiError for an unknown id", async () => {
    const api = createInMemoryProfileApi({ profiles });

    await expect(api.fetchProfile("nope")).rejects.toBeInstanceOf(ProfileApiError);
    await expect(api.fetchProfile("nope")).rejects.toThrow("No profile with id nope");
  });

  it("fails only the ids failWhen names", async () => {
    const api = createInMemoryProfileApi({
      profiles,
      failWhen: (id) => (id === "u-2" ? "Service unavailable" : null),
    });

    await expect(api.fetchProfile("u-1")).resolves.toEqual(profiles[0]);
    await expect(api.fetchProfile("u-2")).rejects.toThrow("Service unavailable");
  });

  it("counts every request, including failures", async () => {
    const api = createInMemoryProfileApi({ profiles, failWhen: () => "down" });

    expect(api.requestCount()).toBe(0);
    await expect(api.fetchProfile("u-1")).rejects.toThrow("down");
    await expect(api.fetchProfile("u-1")).rejects.toThrow("down");
    expect(api.requestCount()).toBe(2);
  });

  it("stays asynchronous at zero latency", async () => {
    const api = createInMemoryProfileApi({ profiles, latencyMs: 0 });
    let settled = false;

    const pending = api.fetchProfile("u-1").then(() => {
      settled = true;
    });

    // A synchronously-resolved promise would never suspend, which would make
    // every zero-latency Suspense test pass without exercising Suspense.
    expect(settled).toBe(false);
    await pending;
    expect(settled).toBe(true);
  });
});
