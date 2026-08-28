import { describe, it, expect } from "vitest";
import { createStubApiClient } from "@/shared/api/createStubApiClient";
import { POST_FEED_QUERY_KEY, fetchPostFeed } from "@/entities/post/postFeed";

describe("fetchPostFeed", () => {
  it("reads GET /posts from the client it is given", async () => {
    const client = createStubApiClient({
      routes: { "GET /posts": [{ id: 1, title: "First", body: "…", userId: 1 }] },
    });

    await expect(fetchPostFeed(client)).resolves.toEqual([
      { id: 1, title: "First", body: "…", userId: 1 },
    ]);
    expect(client.calls).toEqual([{ method: "GET", path: "/posts" }]);
  });

  it("has a stable query key", () => {
    expect(POST_FEED_QUERY_KEY).toEqual(["post-feed"]);
  });
});
