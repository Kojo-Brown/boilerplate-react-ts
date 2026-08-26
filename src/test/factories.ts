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

export interface AuthTokenResponse {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export function makeAuthResponse(overrides: Partial<AuthTokenResponse> = {}): AuthTokenResponse {
  return {
    token: "mock-access-token",
    refreshToken: "mock-refresh-token",
    expiresIn: 900,
    user: makeUser(),
    ...overrides,
  };
}
