import type { ApiClient, ApiRequestOptions } from "@/shared/api/apiClient";
import type { Post } from "@/entities/post/postsApi";

/**
 * The post feed, read through an injected {@link ApiClient}.
 *
 * The interesting thing about this module is what it does *not* import. It
 * makes an HTTP request and it names no base URL, no token, no `fetch` and no
 * store — the client arrives as an argument, so the same function serves the
 * running application, a unit test with a stub, and a Storybook story with a
 * different stub. Before the client moved into `shared/api` this module could
 * not have existed at all: the client lived in `app/`, and an entity importing
 * upward is a lint error (`docs/feature-sliced-design.md`).
 *
 * Kept separate from `postsApi.ts`, which is the RTK Query surface for the same
 * resource. Both are legitimate; they are two demonstrations, not two attempts
 * at one thing.
 */
export const POST_FEED_QUERY_KEY = ["post-feed"] as const;

/** `GET /posts`. `options` carries the caller's `AbortSignal`, if any. */
export function fetchPostFeed(client: ApiClient, options?: ApiRequestOptions): Promise<Post[]> {
  return client.get<Post[]>("/posts", options);
}
