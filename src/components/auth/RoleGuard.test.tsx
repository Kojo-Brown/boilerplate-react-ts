import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import type { ReactNode } from "react";
import { makeStore } from "@/test/renderWithProviders";
import { setCredentials } from "@/store/authSlice";
import { AuthProvider } from "@/context/AuthContext";
import { RoleGuard } from "./RoleGuard";

function Wrapper({
  store,
  children,
}: {
  store: ReturnType<typeof makeStore>;
  children: ReactNode;
}) {
  return (
    <Provider store={store}>
      <AuthProvider>{children}</AuthProvider>
    </Provider>
  );
}

describe("RoleGuard", () => {
  it("renders children when user has the required role", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        refreshToken: "ref",
        expiresIn: 900,
        user: { id: "1", email: "admin@example.com", role: "admin" },
      }),
    );
    render(
      <Wrapper store={store}>
        <RoleGuard roles={["admin"]}>
          <div>Admin Content</div>
        </RoleGuard>
      </Wrapper>,
    );
    expect(screen.getByText("Admin Content")).toBeInTheDocument();
  });

  it("does not render children when user lacks the required role", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        refreshToken: "ref",
        expiresIn: 900,
        user: { id: "1", email: "user@example.com", role: "user" },
      }),
    );
    render(
      <Wrapper store={store}>
        <RoleGuard roles={["admin"]}>
          <div>Admin Content</div>
        </RoleGuard>
      </Wrapper>,
    );
    expect(screen.queryByText("Admin Content")).not.toBeInTheDocument();
  });

  it("renders fallback when user lacks the required role", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        refreshToken: "ref",
        expiresIn: 900,
        user: { id: "1", email: "user@example.com", role: "user" },
      }),
    );
    render(
      <Wrapper store={store}>
        <RoleGuard roles={["admin"]} fallback={<div>Access Denied</div>}>
          <div>Admin Content</div>
        </RoleGuard>
      </Wrapper>,
    );
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByText("Admin Content")).not.toBeInTheDocument();
  });

  it("renders children when user has any of the accepted roles", () => {
    const store = makeStore();
    store.dispatch(
      setCredentials({
        token: "tok",
        refreshToken: "ref",
        expiresIn: 900,
        user: { id: "1", email: "editor@example.com", role: "editor" },
      }),
    );
    render(
      <Wrapper store={store}>
        <RoleGuard roles={["admin", "editor"]}>
          <div>Editor Content</div>
        </RoleGuard>
      </Wrapper>,
    );
    expect(screen.getByText("Editor Content")).toBeInTheDocument();
  });

  it("renders nothing by default when unauthenticated and no fallback", () => {
    const store = makeStore();
    render(
      <Wrapper store={store}>
        <RoleGuard roles={["admin"]}>
          <div>Admin Content</div>
        </RoleGuard>
      </Wrapper>,
    );
    expect(screen.queryByText("Admin Content")).not.toBeInTheDocument();
  });
});
