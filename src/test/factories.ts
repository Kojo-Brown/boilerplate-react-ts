import type { AuthUser } from "@/entities/session/authSlice";
import type { Post, CreatePostInput } from "@/entities/post/postsApi";

let _seq = 1;
const nextId = () => _seq++;

export function resetFactorySequence(): void {
  _seq = 1;
}

export function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  const id = nextId();
  return {
    id: String(id),
    email: `user${id}@example.com`,
    role: "user",
    ...overrides,
  };
}

export function makeAdminUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return makeUser({ role: "admin", ...overrides });
}

export function makePost(overrides: Partial<Post> = {}): Post {
  const id = nextId();
  return {
    id,
    title: `Post ${id}`,
    body: `Body content for post ${id}`,
    userId: 1,
    ...overrides,
  };
}

export function makePostList(count: number, overrides: Partial<Post> = {}): Post[] {
  return Array.from({ length: count }, () => makePost(overrides));
}

export function makeCreatePostInput(overrides: Partial<CreatePostInput> = {}): CreatePostInput {
  const id = nextId();
  return {
    title: `New Post ${id}`,
    body: `New body content ${id}`,
    userId: 1,
    ...overrides,
  };
}

/**
 * A successful `POST /auth/login` or `/auth/refresh`, as the server now answers.
 *
 * `refreshToken` was a field here until the refresh token moved into an
 * `HttpOnly` cookie. Removing it from the factory matters more than it looks:
 * a factory is the shape test authors copy, so one that kept minting a refresh
 * token would keep producing tests that pass against a response the server
 * never sends — and would quietly invite the next person to read it from the
 * body. The cookie is issued by `Set-Cookie` in `shared/mocks/handlers.ts`.
 */
export interface AuthTokenResponse {
  token: string;
  expiresIn: number;
  user: AuthUser;
}

export function makeAuthResponse(overrides: Partial<AuthTokenResponse> = {}): AuthTokenResponse {
  return {
    token: "mock-access-token",
    expiresIn: 900,
    user: makeUser(),
    ...overrides,
  };
}
