import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderWithProviders } from "@/test/renderWithProviders";
import { server } from "@/shared/mocks/server";
import {
  makeUser,
  makePost,
  makePostList,
  makeAuthResponse,
  resetFactorySequence,
} from "@/test/factories";

const API = "http://localhost:4000";

beforeEach(() => {
  resetFactorySequence();
});

describe("MSW server lifecycle", () => {
  it("intercepts requests using default handlers", async () => {
    let intercepted = false;
    server.use(
      http.get(`${API}/health`, () => {
        intercepted = true;
        return HttpResponse.json({ ok: true });
      }),
    );

    const res = await fetch(`${API}/health`);
    const json = (await res.json()) as { ok: boolean };

    expect(intercepted).toBe(true);
    expect(json.ok).toBe(true);
  });

  it("handler added per-test is scoped to that test", async () => {
    server.use(http.get(`${API}/temp`, () => HttpResponse.json({ ephemeral: true })));

    const res = await fetch(`${API}/temp`);
    expect(res.ok).toBe(true);
  });
});

describe("factory functions", () => {
  it("makeUser creates a user with sensible defaults", () => {
    const user = makeUser();
    expect(user.id).toBeDefined();
    expect(user.email).toMatch(/@example\.com$/);
    expect(user.role).toBe("user");
  });

  it("makeUser accepts overrides", () => {
    const admin = makeUser({ role: "admin", email: "admin@company.com" });
    expect(admin.role).toBe("admin");
    expect(admin.email).toBe("admin@company.com");
  });

  it("makePost creates a post with sensible defaults", () => {
    const post = makePost();
    expect(typeof post.id).toBe("number");
    expect(post.title).toContain("Post");
    expect(post.userId).toBe(1);
  });

  it("makePostList creates N posts with unique ids", () => {
    const posts = makePostList(3);
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((p) => p.id)).size).toBe(3);
  });

  it("makeAuthResponse includes a user and tokens", () => {
    const response = makeAuthResponse();
    expect(response.token).toBe("mock-access-token");
    expect(response.refreshToken).toBe("mock-refresh-token");
    expect(response.expiresIn).toBe(900);
    expect(response.user).toBeDefined();
  });

  it("makeAuthResponse accepts partial overrides", () => {
    const user = makeUser({ role: "admin" });
    const response = makeAuthResponse({ token: "custom-token", user });
    expect(response.token).toBe("custom-token");
    expect(response.user.role).toBe("admin");
  });
});

describe("MSW handler override pattern", () => {
  it("per-test server.use overrides the default handler", async () => {
    const posts = makePostList(1, { title: "Override Post" });
    server.use(http.get(`${API}/posts`, () => HttpResponse.json(posts)));

    const res = await fetch(`${API}/posts`);
    const data = (await res.json()) as typeof posts;

    expect(data[0]?.title).toBe("Override Post");
  });

  it("can simulate server errors for error-state testing", async () => {
    server.use(
      http.get(`${API}/posts`, () =>
        HttpResponse.json({ error: "Internal Server Error" }, { status: 500 }),
      ),
    );

    const res = await fetch(`${API}/posts`);
    expect(res.status).toBe(500);
  });

  it("can override a specific post endpoint", async () => {
    const mockPost = makePost({ title: "Specific Post" });
    server.use(http.get(`${API}/posts/99`, () => HttpResponse.json(mockPost)));

    const res = await fetch(`${API}/posts/99`);
    const data = (await res.json()) as typeof mockPost;
    expect(data.title).toBe("Specific Post");
  });
});

describe("renderWithProviders integration", () => {
  it("renders a component that fetches data via MSW", async () => {
    const mockUser = makeUser({ email: "fetched@example.com" });
    server.use(http.get(`${API}/auth/me`, () => HttpResponse.json(mockUser)));

    function UserEmail() {
      const [email, setEmail] = React.useState<string | null>(null);
      React.useEffect(() => {
        void fetch(`${API}/auth/me`)
          .then((r) => r.json())
          .then((u: { email: string }) => {
            setEmail(u.email);
          });
      }, []);
      return <p>{email ?? "loading"}</p>;
    }

    renderWithProviders(<UserEmail />);
    expect(screen.getByText("loading")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("fetched@example.com")).toBeInTheDocument();
    });
  });

  it("supports userEvent interactions with MSW-backed components", async () => {
    const user = userEvent.setup();
    const authResponse = makeAuthResponse({ token: "interaction-token" });
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json(authResponse)));

    let capturedToken: string | null = null;

    function LoginTrigger() {
      const [done, setDone] = React.useState(false);
      async function handleClick() {
        const res = await fetch(`${API}/auth/login`, { method: "POST" });
        const data = (await res.json()) as { token: string };
        capturedToken = data.token;
        setDone(true);
      }
      return <button onClick={() => void handleClick()}>{done ? "done" : "login"}</button>;
    }

    renderWithProviders(<LoginTrigger />);
    await user.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() => {
      expect(screen.getByText("done")).toBeInTheDocument();
    });
    expect(capturedToken).toBe("interaction-token");
  });
});
