import { describe, it, expect } from "vitest";
import { describeFate, describeWrite } from "@/features/offline/describeWrite";

describe("describeWrite", () => {
  it("names a write by its method and path", () => {
    expect(describeWrite({ method: "post", url: "https://app.test/api/posts", fate: "sent" })).toBe(
      "POST /api/posts",
    );
  });

  it("drops the query string", () => {
    /*
      Not only for length. A URL is the one part of a request that routinely
      carries a token in a `?` parameter — a signed download link, a one-time
      invite — and this string is rendered into the DOM, read aloud by screen
      readers, and pasted into bug reports. The path says which resource
      without carrying anything that grants access to it.
    */
    expect(
      describeWrite({
        method: "GET",
        url: "https://app.test/api/posts/7?token=mock-signed-token",
        fate: "sent",
      }),
    ).toBe("GET /api/posts/7");
  });

  it("falls back to the raw value for a URL it cannot parse", () => {
    // The base makes the parse total for almost any string — `"::::"` comes
    // back as the relative path `/::::` — but not for every one: an authority
    // that is present and empty is rejected outright. The method and the fate
    // are still true either way, and they are most of what the sentence says,
    // so a thrown parser must not take the whole notice down with it.
    expect(describeWrite({ method: "PUT", url: "http://", fate: "exhausted" })).toBe("PUT http://");
  });
});

describe("describeFate", () => {
  it.each([
    ["expired", { fate: "expired" as const }, "waited too long to be sent"],
    ["exhausted", { fate: "exhausted" as const }, "could not reach the server"],
    [
      "rejected with a status",
      { fate: "rejected" as const, status: 422 },
      "was refused by the server (422)",
    ],
    ["rejected with none", { fate: "rejected" as const }, "was refused by the server"],
  ])("explains %s", (_case, write, expected) => {
    expect(describeFate({ method: "POST", url: "/api/posts", ...write })).toBe(expected);
  });

  it("has no phrase for a delivered write", () => {
    // This is the vocabulary of the loss notice, and a delivered write is not
    // a loss. Returning something for it would make "0 changes could not be
    // saved" renderable.
    expect(
      describeFate({ method: "POST", url: "/api/posts", fate: "sent", status: 201 }),
    ).toBeNull();
  });
});
