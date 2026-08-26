import { createMemoryRouter, RouterProvider } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ErrorPage from "@/pages/error/ErrorPage";

function routerWithError(error: unknown) {
  return createMemoryRouter(
    [
      {
        path: "/",
        loader: () => {
          throw error;
        },
        element: <div>Never shown</div>,
        errorElement: <ErrorPage />,
      },
      { path: "/home", element: <div>Home page</div> },
    ],
    { initialEntries: ["/"] },
  );
}

describe("ErrorPage", () => {
  it("shows 404 status and title for route error responses", async () => {
    const error404 = { status: 404, statusText: "Not Found", internal: false, data: null };
    render(<RouterProvider router={routerWithError(error404)} />);
    await waitFor(() => {
      expect(screen.getByText("404")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    });
  });

  it("shows 500 and the error message for plain Error instances", async () => {
    render(<RouterProvider router={routerWithError(new Error("DB connection failed"))} />);
    await waitFor(() => {
      expect(screen.getByText("500")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
      expect(screen.getByText("DB connection failed")).toBeInTheDocument();
    });
  });

  it("shows 500 for unknown error types", async () => {
    render(<RouterProvider router={routerWithError("string error")} />);
    await waitFor(() => {
      expect(screen.getByText("500")).toBeInTheDocument();
    });
  });

  it("renders Try again and Go home buttons", async () => {
    render(<RouterProvider router={routerWithError(new Error("oops"))} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Go home" })).toBeInTheDocument();
    });
  });

  it("navigates to home when Go home is clicked", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/broken",
          loader: () => {
            throw new Error("crash");
          },
          element: <div>Never</div>,
          errorElement: <ErrorPage />,
        },
        { path: "/", element: <div>Home page</div> },
      ],
      { initialEntries: ["/broken"] },
    );
    render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Go home" })).toBeInTheDocument();
    });
    screen.getByRole("button", { name: "Go home" }).click();
    await waitFor(() => {
      expect(screen.getByText("Home page")).toBeInTheDocument();
    });
  });
});
