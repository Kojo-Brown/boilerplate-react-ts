import { describe, it, expect } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useOptimisticList, type OptimisticMutation } from "@/hooks/useOptimisticList";
import type { ListAction, OptimisticListItem } from "@/lib/optimisticList";

interface Row extends OptimisticListItem {
  title: string;
}

const seed: readonly Row[] = [{ id: "a", title: "Alpha" }];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

/**
 * A promise whose settlement the test controls, so the window in which the
 * optimistic value is on screen can be asserted rather than raced against.
 */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Settles a gate and lets React finish the transition that was waiting on it.
 * The extra tick is not ceremony: the transition resumes on a microtask, so
 * `act` has to stay open past the `resolve`/`reject` for the resulting render
 * to be flushed before the assertions run.
 */
async function settle(release: () => void): Promise<void> {
  await act(async () => {
    release();
    await Promise.resolve();
  });
}

interface HarnessProps {
  mutations: readonly OptimisticMutation<Row>[];
}

/**
 * Renders the hook's whole surface as text. `useOptimistic` only works inside a
 * real render, so the hook is exercised through a component rather than
 * `renderHook` — and serialising both lists is what makes "the optimistic list
 * changed but the committed list did not" directly assertable.
 */
function Harness({ mutations }: HarnessProps) {
  const { items, committedItems, isPending, error, clearError, mutate } =
    useOptimisticList<Row>(seed);

  return (
    <div>
      <ul data-testid="items">
        {items.map((row) => (
          <li key={row.id} data-testid="item" data-pending={row.pending ?? ""}>
            {row.title}
          </li>
        ))}
      </ul>
      <p data-testid="committed">{committedItems.map((row) => row.id).join(",")}</p>
      <p data-testid="pending">{String(isPending)}</p>
      <p data-testid="error">{error?.message ?? ""}</p>
      <button onClick={clearError}>clear</button>
      {mutations.map((mutation, index) => (
        <button
          key={index}
          onClick={() => {
            mutate(mutation);
          }}
        >
          mutate-{index}
        </button>
      ))}
    </div>
  );
}

const itemTitles = (): string[] => screen.queryAllByTestId("item").map((el) => el.textContent);
const committedIds = (): string => screen.getByTestId("committed").textContent;
const errorText = (): string => screen.getByTestId("error").textContent;

function createRow(id: string, title: string): ListAction<Row> {
  return { type: "create", item: { id, title } };
}

describe("useOptimisticList", () => {
  it("starts from the initial items with nothing pending", () => {
    render(<Harness mutations={[]} />);

    expect(itemTitles()).toEqual(["Alpha"]);
    expect(committedIds()).toBe("a");
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  it("shows a created row before the server has confirmed it", async () => {
    const user = userEvent.setup();
    const gate = deferred<ListAction<Row>>();
    render(
      <Harness
        mutations={[{ optimistic: createRow("draft-1", "Beta"), commit: () => gate.promise }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));

    expect(itemTitles()).toEqual(["Alpha", "Beta"]);
    expect(screen.getAllByTestId("item")[1]).toHaveAttribute("data-pending", "create");
    // The optimistic row exists only in the rendered list — server truth is untouched.
    expect(committedIds()).toBe("a");
    expect(screen.getByTestId("pending")).toHaveTextContent("true");

    await settle(() => {
      gate.resolve(createRow("server-1", "Beta"));
    });
  });

  it("replaces the optimistic row with the server's row on success", async () => {
    const user = userEvent.setup();
    const gate = deferred<ListAction<Row>>();
    render(
      <Harness
        mutations={[{ optimistic: createRow("draft-1", "Beta"), commit: () => gate.promise }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));
    await settle(() => {
      gate.resolve(createRow("server-1", "Beta"));
    });

    expect(itemTitles()).toEqual(["Alpha", "Beta"]);
    // The draft id is gone: what is on screen now is the committed row.
    expect(committedIds()).toBe("a,server-1");
    expect(screen.getAllByTestId("item")[1]).toHaveAttribute("data-pending", "");
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  it("rolls a created row back when the commit rejects", async () => {
    const user = userEvent.setup();
    const gate = deferred<ListAction<Row>>();
    render(
      <Harness
        mutations={[{ optimistic: createRow("draft-1", "Beta"), commit: () => gate.promise }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));
    expect(itemTitles()).toEqual(["Alpha", "Beta"]);

    await settle(() => {
      gate.reject(new Error("Server said no"));
    });

    expect(itemTitles()).toEqual(["Alpha"]);
    expect(committedIds()).toBe("a");
    expect(errorText()).toBe("Server said no");
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  it("rolls an update back, restoring the committed field value", async () => {
    const user = userEvent.setup();
    const gate = deferred<ListAction<Row>>();
    render(
      <Harness
        mutations={[
          {
            optimistic: { type: "update", id: "a", patch: { title: "Renamed" } },
            commit: () => gate.promise,
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));
    expect(itemTitles()).toEqual(["Renamed"]);

    await settle(() => {
      gate.reject(new Error("Rename rejected"));
    });

    expect(itemTitles()).toEqual(["Alpha"]);
  });

  it("rolls a delete back, putting the row returned to the list", async () => {
    const user = userEvent.setup();
    const gate = deferred<ListAction<Row>>();
    render(
      <Harness
        mutations={[{ optimistic: { type: "delete", id: "a" }, commit: () => gate.promise }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));
    expect(itemTitles()).toEqual([]);

    await settle(() => {
      gate.reject(new Error("Delete rejected"));
    });

    expect(itemTitles()).toEqual(["Alpha"]);
    expect(committedIds()).toBe("a");
  });

  it("wraps a non-Error rejection so `error.message` is always readable", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        mutations={[
          {
            optimistic: createRow("draft-1", "Beta"),
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point of this test is a caller that rejects with a non-Error
            commit: () => Promise.reject("plain string failure"),
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));

    expect(await screen.findByText("plain string failure")).toBeInTheDocument();
    expect(itemTitles()).toEqual(["Alpha"]);
  });

  it("clears the error on demand", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        mutations={[
          {
            optimistic: createRow("draft-1", "Beta"),
            commit: () => Promise.reject(new Error("Server said no")),
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));
    expect(await screen.findByText("Server said no")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "clear" }));

    expect(errorText()).toBe("");
  });

  it("clears a stale error when the next mutation starts", async () => {
    const user = userEvent.setup();
    const gate = deferred<ListAction<Row>>();
    render(
      <Harness
        mutations={[
          {
            optimistic: createRow("draft-1", "Beta"),
            commit: () => Promise.reject(new Error("Server said no")),
          },
          { optimistic: createRow("draft-2", "Gamma"), commit: () => gate.promise },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));
    expect(await screen.findByText("Server said no")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "mutate-1" }));

    expect(errorText()).toBe("");

    await settle(() => {
      gate.resolve(createRow("server-2", "Gamma"));
    });
  });

  it("layers concurrent mutations without letting them clobber each other", async () => {
    const user = userEvent.setup();
    const first = deferred<ListAction<Row>>();
    const second = deferred<ListAction<Row>>();
    render(
      <Harness
        mutations={[
          { optimistic: createRow("draft-1", "Beta"), commit: () => first.promise },
          { optimistic: createRow("draft-2", "Gamma"), commit: () => second.promise },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));
    await user.click(screen.getByRole("button", { name: "mutate-1" }));

    expect(itemTitles()).toEqual(["Alpha", "Beta", "Gamma"]);

    // Settle out of order: the second request comes back first.
    await settle(() => {
      second.resolve(createRow("server-2", "Gamma"));
    });
    await settle(() => {
      first.resolve(createRow("server-1", "Beta"));
    });

    // Both commits survive. A non-functional `setCommittedItems` would have
    // dropped whichever one resolved first.
    expect(committedIds()).toBe("a,server-2,server-1");
    expect(itemTitles()).toEqual(["Alpha", "Gamma", "Beta"]);
  });

  it("unwinds overlapping optimistic actions as a group, not individually", async () => {
    const user = userEvent.setup();
    const failing = deferred<ListAction<Row>>();
    const succeeding = deferred<ListAction<Row>>();
    render(
      <Harness
        mutations={[
          { optimistic: createRow("draft-1", "Beta"), commit: () => failing.promise },
          { optimistic: createRow("draft-2", "Gamma"), commit: () => succeeding.promise },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "mutate-0" }));
    await user.click(screen.getByRole("button", { name: "mutate-1" }));

    await settle(() => {
      failing.reject(new Error("Beta rejected"));
    });

    // React holds the whole optimistic layer until the *last* in-flight action
    // settles, so Beta is still rendered even though its own commit already
    // failed and the error is already up. This is React's model, not a choice
    // this hook makes — it is asserted here so the frame is documented rather
    // than discovered in production.
    expect(itemTitles()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(errorText()).toBe("Beta rejected");
    expect(committedIds()).toBe("a");

    await settle(() => {
      succeeding.resolve(createRow("server-2", "Gamma"));
    });

    // Last action settled: the layer is discarded and the list snaps to truth.
    // Beta never made it into the committed list, so the rollback stands.
    expect(itemTitles()).toEqual(["Alpha", "Gamma"]);
    expect(committedIds()).toBe("a,server-2");
    expect(errorText()).toBe("Beta rejected");
  });
});
