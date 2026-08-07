import { describe, it, expect } from "vitest";
import {
  applyCommittedAction,
  applyOptimisticAction,
  type ListAction,
  type OptimisticListItem,
} from "@/lib/optimisticList";

interface Row extends OptimisticListItem {
  title: string;
  done: boolean;
}

const rows: readonly Row[] = [
  { id: "a", title: "Alpha", done: false },
  { id: "b", title: "Beta", done: true },
];

describe("applyOptimisticAction", () => {
  it("appends a created row and marks it pending", () => {
    const item: Row = { id: "c", title: "Gamma", done: false };
    const next = applyOptimisticAction(rows, { type: "create", item });

    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ id: "c", title: "Gamma", done: false, pending: "create" });
  });

  it("patches a row and marks it pending", () => {
    const next = applyOptimisticAction(rows, { type: "update", id: "a", patch: { done: true } });

    expect(next[0]).toEqual({ id: "a", title: "Alpha", done: true, pending: "update" });
  });

  it("leaves untouched rows referentially identical", () => {
    const next = applyOptimisticAction(rows, { type: "update", id: "a", patch: { done: true } });

    expect(next[1]).toBe(rows[1]);
  });

  it("removes a deleted row", () => {
    const next = applyOptimisticAction(rows, { type: "delete", id: "a" });

    expect(next.map((row) => row.id)).toEqual(["b"]);
  });

  it("is a no-op for an update or delete targeting an unknown id", () => {
    expect(
      applyOptimisticAction(rows, { type: "update", id: "zz", patch: { done: true } }),
    ).toEqual(rows);
    expect(applyOptimisticAction(rows, { type: "delete", id: "zz" })).toEqual(rows);
  });

  it("never mutates the input", () => {
    const snapshot = structuredClone(rows);
    applyOptimisticAction(rows, { type: "update", id: "a", patch: { title: "Changed" } });
    applyOptimisticAction(rows, { type: "delete", id: "b" });

    expect(rows).toEqual(snapshot);
  });

  it("composes when replayed for several in-flight actions", () => {
    // This is how React uses the reducer: every pending action, in order, over
    // the latest committed list.
    const actions: ListAction<Row>[] = [
      { type: "create", item: { id: "c", title: "Gamma", done: false } },
      { type: "update", id: "a", patch: { done: true } },
      { type: "delete", id: "b" },
    ];
    const next = actions.reduce(applyOptimisticAction<Row>, rows);

    expect(next).toEqual([
      { id: "a", title: "Alpha", done: true, pending: "update" },
      { id: "c", title: "Gamma", done: false, pending: "create" },
    ]);
  });
});

describe("applyCommittedAction", () => {
  it("appends a created row without a pending marker", () => {
    const item: Row = { id: "c", title: "Gamma", done: false };
    const next = applyCommittedAction(rows, { type: "create", item });

    expect(next[2]).toEqual({ id: "c", title: "Gamma", done: false });
    expect(next[2]).not.toHaveProperty("pending");
  });

  it("strips a pending marker that came in on the committed row", () => {
    const item: Row = { id: "c", title: "Gamma", done: false, pending: "create" };
    const next = applyCommittedAction(rows, { type: "create", item });

    expect(next[2]).not.toHaveProperty("pending");
  });

  it("patches a row without marking it pending", () => {
    const next = applyCommittedAction(rows, { type: "update", id: "b", patch: { title: "Bee" } });

    expect(next[1]).toEqual({ id: "b", title: "Bee", done: true });
  });

  it("clears the pending marker when an optimistic row is committed", () => {
    const optimistic = applyOptimisticAction(rows, {
      type: "update",
      id: "a",
      patch: { done: true },
    });
    const committed = applyCommittedAction(optimistic, {
      type: "update",
      id: "a",
      patch: { done: true },
    });

    expect(committed[0]).not.toHaveProperty("pending");
  });

  it("removes a deleted row", () => {
    expect(applyCommittedAction(rows, { type: "delete", id: "b" }).map((r) => r.id)).toEqual(["a"]);
  });

  it("agrees with the optimistic pass on everything except pending", () => {
    const action: ListAction<Row> = { type: "update", id: "a", patch: { title: "Renamed" } };
    const [optimisticRow] = applyOptimisticAction(rows, action);
    const [committedRow] = applyCommittedAction(rows, action);

    expect(optimisticRow).toEqual({ ...committedRow, pending: "update" });
  });
});
