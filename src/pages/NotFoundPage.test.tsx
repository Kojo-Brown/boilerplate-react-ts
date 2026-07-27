import { createMemoryRouter, RouterProvider } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NotFoundPage } from "./NotFoundPage";

function setup() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <div>Home page</div> },
      { path: "/not-found", element: <NotFoundPage /> },
    ],
    { initialEntries: ["/not-found"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("NotFoundPage", () => {
  it("renders 404 status code", () => {
    setup();
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("renders page not found heading", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it("renders a description", () => {
    setup();
    expect(screen.getByText(/exist or has been moved/i)).toBeInTheDocument();
  });

  it("navigates to home when Go home is clicked", async () => {
    setup();
    screen.getByRole("button", { name: /go home/i }).click();
    await waitFor(() => {
      expect(screen.getByText("Home page")).toBeInTheDocument();
    });
  });
});
