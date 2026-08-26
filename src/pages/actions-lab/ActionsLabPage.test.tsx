import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ActionsLabPage } from "@/pages/actions-lab/ActionsLabPage";
import { INVITE_OUTAGE_MESSAGE, SEEDED_TEAM_EMAIL } from "@/pages/actions-lab/actionsLabParams";

function renderLab(search = "?latency=0") {
  const router = createMemoryRouter([{ path: "/labs/actions", element: <ActionsLabPage /> }], {
    initialEntries: [`/labs/actions${search}`],
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

async function invite(user: ReturnType<typeof userEvent.setup>, address: string): Promise<void> {
  await user.type(screen.getByTestId("invite-email"), address);
  await user.click(screen.getByTestId("submit-button"));
}

describe("ActionsLabPage", () => {
  it("renders the lab heading", () => {
    renderLab();

    expect(screen.getByRole("heading", { name: "Actions Lab" })).toBeInTheDocument();
  });

  it("defaults to the healthy server", () => {
    renderLab();

    expect(screen.getByRole("button", { name: "Healthy server" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("reads the failing server from the URL", () => {
    renderLab("?server=failing&latency=0");

    expect(screen.getByRole("button", { name: "Failing server" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("treats an unknown server mode as healthy", () => {
    renderLab("?server=nonsense&latency=0");

    expect(screen.getByRole("button", { name: "Healthy server" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("sends an invitation against the healthy server", async () => {
    const user = userEvent.setup();
    renderLab();

    await invite(user, "grace@example.com");

    expect(await screen.findByTestId("invite-success")).toHaveTextContent(
      "Invitation sent to grace@example.com as member.",
    );
  });

  it("rejects the seeded address, so the server-only failure is reachable by typing", async () => {
    const user = userEvent.setup();
    renderLab();

    await invite(user, SEEDED_TEAM_EMAIL);

    expect(await screen.findByText(`${SEEDED_TEAM_EMAIL} is already on the team.`)).toBeVisible();
  });

  it("reports a form-level failure against the failing server", async () => {
    const user = userEvent.setup();
    renderLab("?server=failing&latency=0");

    await invite(user, "grace@example.com");

    expect(await screen.findByTestId("invite-error")).toHaveTextContent(INVITE_OUTAGE_MESSAGE);
  });

  it("writes the selected server mode back to the URL", async () => {
    const user = userEvent.setup();
    const { router } = renderLab();

    await user.click(screen.getByRole("button", { name: "Failing server" }));

    expect(router.state.location.search).toContain("server=failing");
  });

  it("writes the selected latency back to the URL and preserves the server mode", async () => {
    const user = userEvent.setup();
    const { router } = renderLab("?server=failing&latency=0");

    await user.selectOptions(screen.getByTestId("latency-select"), "600");

    expect(router.state.location.search).toContain("latency=600");
    expect(router.state.location.search).toContain("server=failing");
  });

  it("reads the latency selection from the URL", () => {
    renderLab("?latency=2000");

    expect(screen.getByTestId("latency-select")).toHaveValue("2000");
  });

  it("drops a message about the previous server when the server is swapped", async () => {
    const user = userEvent.setup();
    renderLab();

    await invite(user, "grace@example.com");
    await screen.findByTestId("invite-success");

    await user.click(screen.getByRole("button", { name: "Failing server" }));

    expect(screen.queryByTestId("invite-success")).not.toBeInTheDocument();
  });
});
