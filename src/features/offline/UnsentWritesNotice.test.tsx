import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnsentWritesNotice } from "@/features/offline/UnsentWritesNotice";
import type { UnsentWrites } from "@/shared/offline/offlineClient";

const noop = (): void => undefined;

function renderNotice(unsent: UnsentWrites, onDismiss: () => void = noop) {
  return render(<UnsentWritesNotice unsent={unsent} onDismiss={onDismiss} />);
}

describe("UnsentWritesNotice", () => {
  it("renders nothing while nothing has been lost", () => {
    const { container } = renderNotice({ count: 0, writes: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it("interrupts, rather than waiting its turn", () => {
    // `role="alert"` is assertive, which is normally rude and is right here: a
    // connectivity change is worth mentioning when convenient, and "the thing
    // you saved was not saved" is worth saying now.
    renderNotice({
      count: 1,
      writes: [{ method: "POST", url: "/api/posts", fate: "exhausted" }],
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("names each lost write and why it was given up on", () => {
    renderNotice({
      count: 3,
      writes: [
        { method: "post", url: "https://app.test/api/posts?draft=1", fate: "exhausted" },
        { method: "PUT", url: "https://app.test/api/posts/7", fate: "rejected", status: 409 },
        { method: "DELETE", url: "https://app.test/api/posts/8", fate: "expired" },
      ],
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("3 changes could not be saved");
    // Uppercased, and the query string dropped — a URL is the one part of a
    // request that routinely carries a token in a `?` parameter, and this
    // string is rendered into the DOM and read aloud.
    expect(alert).toHaveTextContent("POST /api/posts could not reach the server");
    expect(alert).toHaveTextContent("PUT /api/posts/7 was refused by the server (409)");
    expect(alert).toHaveTextContent("DELETE /api/posts/8 waited too long to be sent");
    expect(alert).not.toHaveTextContent("draft=1");
  });

  it("reports the count even when the worker could not name the writes", () => {
    /*
      The version-skew case, and the one a component rendering `writes.length`
      would get silently wrong. A worker from the previous build says how many
      it abandoned and not which; reporting zero because the list is empty is
      the exact failure this component exists to prevent.
    */
    renderNotice({ count: 2, writes: [] });

    expect(screen.getByRole("alert")).toHaveTextContent("2 changes could not be saved");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("uses the singular for one lost write", () => {
    renderNotice({ count: 1, writes: [] });
    expect(screen.getByRole("alert")).toHaveTextContent("1 change could not be saved");
  });

  it("lists two identical requests as two lost changes", () => {
    // A user who pressed Save twice made two changes, and rendering one row
    // for them would under-report the loss.
    renderNotice({
      count: 2,
      writes: [
        { method: "POST", url: "/api/posts", fate: "exhausted" },
        { method: "POST", url: "/api/posts", fate: "exhausted" },
      ],
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("stays until it is acknowledged, and never on a timer", async () => {
    // A notice about lost work that disappears while the user is looking
    // elsewhere has lost the work twice.
    const onDismiss = vi.fn();
    renderNotice(
      { count: 1, writes: [{ method: "POST", url: "/api/posts", fate: "exhausted" }] },
      onDismiss,
    );

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
