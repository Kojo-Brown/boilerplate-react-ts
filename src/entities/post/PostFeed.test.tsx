import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { ApiError, type ApiClient, type ApiRequestOptions } from "@/shared/api/apiClient";
import { createStubApiClient } from "@/shared/api/createStubApiClient";
import { PostFeed } from "@/entities/post/PostFeed";

const POSTS = [
  { id: 1, title: "First Post", body: "Content one", userId: 1 },
  { id: 2, title: "Second Post", body: "Content two", userId: 1 },
];

describe("<PostFeed>", () => {
  it("renders the posts the injected client returns — no MSW involved", async () => {
    const apiClient = createStubApiClient({ routes: { "GET /posts": POSTS } });

    renderWithProviders(<PostFeed />, { apiClient });

    expect(await screen.findByText("First Post")).toBeInTheDocument();
    expect(screen.getByText("Second Post")).toBeInTheDocument();
    expect(apiClient.calls).toEqual([{ method: "GET", path: "/posts" }]);
  });

  it("shows a skeleton until the request settles", async () => {
    const apiClient = createStubApiClient({ routes: { "GET /posts": POSTS }, latencyMs: 50 });

    renderWithProviders(<PostFeed />, { apiClient });

    expect(screen.getByTestId("post-feed-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("post-feed")).toBeInTheDocument();
  });

  it("renders the error state when the client rejects", async () => {
    const apiClient = createStubApiClient({
      routes: {
        "GET /posts": () => {
          throw new ApiError(503, "Service Unavailable");
        },
      },
    });

    renderWithProviders(<PostFeed />, { apiClient });

    expect(await screen.findByTestId("post-feed-error")).toHaveTextContent("503");
  });

  it("fails loudly when the host forgot to stub the route", async () => {
    // renderWithProviders defaults to a stub with no routes, so a component
    // making an unplanned request says which one instead of reaching the
    // network or hanging on a promise nobody resolves.
    renderWithProviders(<PostFeed />);

    expect(await screen.findByTestId("post-feed-error")).toHaveTextContent("GET /posts");
  });

  it("forwards TanStack Query's AbortSignal to the client", async () => {
    // Without this the query is cancellable in name only: unmounting aborts
    // nothing and the request runs to completion against a gone component.
    let seen: ApiRequestOptions | undefined;
    const recordingClient: ApiClient = {
      get: <T,>(_path: string, options?: ApiRequestOptions) => {
        seen = options;
        return Promise.resolve(POSTS as T);
      },
      post: () => Promise.reject(new Error("not used")),
      put: () => Promise.reject(new Error("not used")),
      patch: () => Promise.reject(new Error("not used")),
      delete: () => Promise.reject(new Error("not used")),
    };

    renderWithProviders(<PostFeed />, { apiClient: recordingClient });

    await screen.findByTestId("post-feed");
    await waitFor(() => {
      expect(seen?.signal).toBeInstanceOf(AbortSignal);
    });
  });
});
