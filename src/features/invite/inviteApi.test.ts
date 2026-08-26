import { describe, it, expect, vi } from "vitest";
import {
  createInMemoryInviteApi,
  InviteRejectedError,
  ROLE_LABELS,
  TEAM_ROLES,
  type InviteInput,
} from "@/features/invite/inviteApi";

const input = (overrides: Partial<InviteInput> = {}): InviteInput => ({
  email: "grace@example.com",
  role: "member",
  note: "",
  ...overrides,
});

describe("TEAM_ROLES", () => {
  it("labels every role", () => {
    for (const role of TEAM_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });
});

describe("createInMemoryInviteApi", () => {
  it("assigns deterministic, incrementing ids", async () => {
    const api = createInMemoryInviteApi();

    expect((await api.invite(input())).id).toBe("invite-1");
    expect((await api.invite(input({ email: "ada@example.com" }))).id).toBe("invite-2");
  });

  it("normalises the email and trims the note", async () => {
    const api = createInMemoryInviteApi();

    expect(await api.invite(input({ email: "  Grace@Example.COM ", note: "  hi  " }))).toEqual({
      id: "invite-1",
      email: "grace@example.com",
      role: "member",
      note: "hi",
    });
  });

  it("keeps the requested role", async () => {
    const api = createInMemoryInviteApi();

    expect((await api.invite(input({ role: "admin" }))).role).toBe("admin");
  });

  it("rejects an address that is already on the team, blaming the email field", async () => {
    const api = createInMemoryInviteApi({ existingEmails: ["ada@example.com"] });

    await expect(api.invite(input({ email: "ada@example.com" }))).rejects.toThrow(
      InviteRejectedError,
    );
    await expect(api.invite(input({ email: "ada@example.com" }))).rejects.toMatchObject({
      field: "email",
    });
  });

  it("matches an existing address case-insensitively", async () => {
    const api = createInMemoryInviteApi({ existingEmails: ["Ada@Example.com"] });

    await expect(api.invite(input({ email: "ADA@example.com" }))).rejects.toThrow(
      "ada@example.com is already on the team.",
    );
  });

  it("rejects the second invitation to the same address", async () => {
    const api = createInMemoryInviteApi();

    await api.invite(input());

    await expect(api.invite(input())).rejects.toMatchObject({ field: "email" });
  });

  it("does not record an address whose invitation was refused", async () => {
    // Otherwise a service outage would quietly consume the address and the
    // retry would fail for a different, wrong reason.
    const api = createInMemoryInviteApi({ failWhen: () => "Service unavailable." });

    await expect(api.invite(input())).rejects.toThrow("Service unavailable.");

    const healthy = createInMemoryInviteApi();
    await expect(healthy.invite(input())).resolves.toMatchObject({ id: "invite-1" });
  });

  it("fails at the form level, with no field, when failWhen returns a message", async () => {
    const api = createInMemoryInviteApi({ failWhen: () => "The service is unavailable." });

    await expect(api.invite(input())).rejects.toMatchObject({
      message: "The service is unavailable.",
      field: null,
    });
  });

  it("lets the call through when failWhen returns null", async () => {
    const api = createInMemoryInviteApi({ failWhen: () => null });

    await expect(api.invite(input())).resolves.toMatchObject({ email: "grace@example.com" });
  });

  it("passes the untouched input to failWhen so a demo can branch on it", async () => {
    const failWhen = vi.fn<(value: InviteInput) => string | null>(() => null);
    const api = createInMemoryInviteApi({ failWhen });

    await api.invite(input({ email: "  Grace@Example.COM " }));

    expect(failWhen).toHaveBeenCalledWith(input({ email: "  Grace@Example.COM " }));
  });

  it("checks the outage before the duplicate, so a broken service reports itself", async () => {
    const api = createInMemoryInviteApi({
      existingEmails: ["ada@example.com"],
      failWhen: () => "The service is unavailable.",
    });

    await expect(api.invite(input({ email: "ada@example.com" }))).rejects.toMatchObject({
      field: null,
    });
  });

  it("waits out the configured latency", async () => {
    vi.useFakeTimers();
    try {
      const api = createInMemoryInviteApi({ latencyMs: 500 });
      const settled = vi.fn();
      void api.invite(input()).then(settled);

      await vi.advanceTimersByTimeAsync(499);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
